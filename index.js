require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

let db;

// Kết nối Database SQLite (tự tạo file database.sqlite nếu chưa có)
(async () => {
    db = await open({
        filename: './database.sqlite',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS transaction_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            amount INTEGER,
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('Database SQLite đã sẵn sàng!');
})();

// Hàm tự động đổi đuôi k, tr thành số chuẩn
function parseAmount(str) {
    let cleanStr = str.replace(/[,.]/g, '').toLowerCase();
    if (cleanStr.endsWith('k')) {
        return parseInt(cleanStr.replace('k', '')) * 1000;
    }
    if (cleanStr.endsWith('tr')) {
        return parseInt(cleanStr.replace('tr', '')) * 1000000;
    }
    return parseInt(cleanStr);
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();

    // 1. Xử lý ghi nhận Thu (+) / Chi (-)
    if (content.startsWith('+') || content.startsWith('-')) {
        const firstSpaceIndex = content.indexOf(' ');
        let amountStr = firstSpaceIndex === -1 ? content : content.substring(0, firstSpaceIndex);
        let reason = firstSpaceIndex === -1 ? 'Không có lý do' : content.substring(firstSpaceIndex + 1);

        const isExpense = amountStr.startsWith('-');
        let cleanAmountStr = amountStr.substring(1); 
        let amount = parseAmount(cleanAmountStr);

        if (isNaN(amount) || amount <= 0) {
            return message.reply('❌ Định dạng sai rồi bạn ơi! Ví dụ chuẩn: `+50k ăn trưa` hoặc `-20000 mua nước`');
        }

        if (isExpense) amount = -amount;

        // Lưu vào DB
        await db.run(
            'INSERT INTO transaction_history (user_id, amount, reason) VALUES (?, ?, ?)',
            [message.author.id, amount, reason]
        );

        const embed = new EmbedBuilder()
            .setColor(isExpense ? 0xff0000 : 0x00ff00)
            .setTitle(isExpense ? '📉 Đã ghi nhận khoản CHI' : '📈 Đã ghi nhận khoản THU')
            .addFields(
                { name: 'Số tiền', value: `${amount.toLocaleString('vi-VN')} VNĐ`, inline: true },
                { name: 'Nội dung', value: reason, inline: true }
            )
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }

    // 2. Xử lý lệnh xem báo cáo tổng kết
    if (content === '!baocao') {
        const totalRow = await db.get('SELECT SUM(amount) as total FROM transaction_history WHERE user_id = ?', [message.author.id]);
        const incomeRow = await db.get('SELECT SUM(amount) as total FROM transaction_history WHERE user_id = ? AND amount > 0', [message.author.id]);
        const expenseRow = await db.get('SELECT SUM(amount) as total FROM transaction_history WHERE user_id = ? AND amount < 0', [message.author.id]);

        const total = totalRow.total || 0;
        const totalIncome = incomeRow.total || 0;
        const totalExpense = Math.abs(expenseRow.total || 0);

        // Lấy 5 lịch sử gần nhất
        const history = await db.all(
            'SELECT amount, reason FROM transaction_history WHERE user_id = ? ORDER BY id DESC LIMIT 5',
            [message.author.id]
        );

        let historyText = history.map(item => {
            const icon = item.amount > 0 ? '🟢 +' : '🔴 ';
            return `${icon}${item.amount.toLocaleString('vi-VN')}đ - *${item.reason}*`;
        }).join('\n') || 'Chưa có giao dịch nào.';

        const reportEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle('💰 THỐNG KÊ TÀI CHÍNH CỦA BẠN')
            .addFields(
                { name: 'Tổng Thu', value: `📈 ${totalIncome.toLocaleString('vi-VN')} VNĐ`, inline: true },
                { name: 'Tổng Chi', value: `📉 ${totalExpense.toLocaleString('vi-VN')} VNĐ`, inline: true },
                { name: 'Số Dư Hiện Tại', value: `💵 **${total.toLocaleString('vi-VN')} VNĐ**`, inline: false },
                { name: '🕒 5 Giao dịch gần đây', value: historyText, inline: false }
            );

        return message.reply({ embeds: [reportEmbed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
// Đoạn code phụ để "lừa" Render rằng đây là một ứng dụng web, tránh bị lỗi sập port
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot đang chạy ngon lành!'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Cổng mạng đã mở tại port ${port}`));
console.log('Bot đang khởi động...');