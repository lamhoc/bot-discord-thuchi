require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { Pool } = require('pg');
const express = require('express');
const moment = require('moment-timezone'); // Sử dụng múi giờ chuẩn

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ID phòng chat nhận thông báo cuối ngày của bạn
const REPORT_CHANNEL_ID = '1416225137291821126'; 

// Kết nối database Supabase gọn gàng, an toàn
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.connect((err) => {
    if (err) console.error('❌ Lỗi kết nối Supabase:', err.stack);
    else console.log('✅ Database Supabase Online đã sẵn sàng!');
});

function parseAmount(str) {
    let cleanStr = str.replace(/[,.]/g, '').toLowerCase();
    if (cleanStr.endsWith('k')) return parseInt(cleanStr.replace('k', '')) * 1000;
    if (cleanStr.endsWith('tr')) return parseInt(cleanStr.replace('tr', '')) * 1000000;
    return parseInt(cleanStr);
}

// 🕒 HÀM TỰ ĐỘNG GỬI BÁO CÁO VÀ RESET DATA VÀO 23:59 (GIỜ VIỆT NAM)
function startDailyResetJob() {
    setInterval(async () => {
        // Ép hệ thống kiểm tra theo đúng múi giờ Việt Nam
        const now = moment().tz("Asia/Ho_Chi_Minh");
        
        // Kiểm tra xem có đúng là 23 giờ 59 phút không
        if (now.hour() === 23 && now.minute() === 59) {
            console.log('🕒 Đúng 23:59 VN, đang tiến hành tổng kết và xóa dữ liệu ngày hôm nay...');
            try {
                const channel = await client.channels.fetch(REPORT_CHANNEL_ID);
                if (!channel) return console.error('❌ Không tìm thấy kênh Discord để gửi báo cáo!');

                // 1. Tính tổng Thu và Chi trong ngày
                const incomeRes = await pool.query('SELECT SUM(amount) as total FROM transaction_history WHERE amount > 0');
                const expenseRes = await pool.query('SELECT SUM(amount) as total FROM transaction_history WHERE amount < 0');

                const totalIncome = incomeRes.rows[0].total || 0;
                const totalExpense = Math.abs(expenseRes.rows[0].total || 0);
                const netSavings = totalIncome - totalExpense;

                // 2. Tạo giao diện báo cáo gửi vào Discord
                const dailyEmbed = new EmbedBuilder()
                    .setColor(0xffd700)
                    .setTitle(`🎯 TỔNG KẾT TÀI CHÍNH CUỐI NGÀY (${now.format('DD/MM/YYYY')})`)
                    .setDescription('Hệ thống sẽ tự động dọn dẹp bộ nhớ ngay sau báo cáo này để tránh đầy dữ liệu.')
                    .addFields(
                        { name: '💰 Tổng Thu Vào', value: `📈 ${totalIncome.toLocaleString('vi-VN')} VNĐ`, inline: true },
                        { name: '💸 Tổng Chi Ra', value: `📉 ${totalExpense.toLocaleString('vi-VN')} VNĐ`, inline: true },
                        { name: '⚖️ Còn Lại', value: `💵 **${netSavings.toLocaleString('vi-VN')} VNĐ**`, inline: false }
                    )
                    .setTimestamp();

                await channel.send({ embeds: [dailyEmbed] });
                console.log('✅ Đã gửi báo cáo ngày thành công.');

                // 3. XÓA SẠCH DỮ LIỆU ĐỂ TRÁNH TRÀN BỘ NHỚ
                await pool.query('DELETE FROM transaction_history');
                console.log('🗑️ Đã xóa sạch dữ liệu cũ thành công!');

            } catch (err) {
                console.error('❌ Lỗi khi chạy tác vụ cuối ngày:', err);
            }
        }
    }, 60000); // Cứ mỗi 1 phút sẽ check thời gian 1 lần
}

client.once('ready', () => {
    console.log(`🤖 Bot ${client.user.tag} đã online!`);
    startDailyResetJob(); 
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content.trim();

    // LỆNH THU (+) / CHI (-)
    if (content.startsWith('+') || content.startsWith('-')) {
        const firstSpaceIndex = content.indexOf(' ');
        let amountStr = firstSpaceIndex === -1 ? content : content.substring(0, firstSpaceIndex);
        let reason = firstSpaceIndex === -1 ? 'Không có lý do' : content.substring(firstSpaceIndex + 1);

        const isExpense = amountStr.startsWith('-');
        let amount = parseAmount(amountStr.substring(1));

        if (isNaN(amount) || amount <= 0) return message.reply('❌ Định dạng tiền sai rồi bạn ơi!');
        if (isExpense) amount = -amount;

        try {
            await pool.query(
                'INSERT INTO transaction_history (user_id, amount, reason) VALUES ($1, $2, $3)',
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
        } catch (err) {
            console.error(err);
            return message.reply('❌ Lỗi lưu dữ liệu!');
        }
    }

    // LỆNH BÁO CÁO CỦA NGÀY HÔM NAY (!baocao)
    if (content === '!baocao') {
        try {
            const totalRes = await pool.query('SELECT SUM(amount) as total FROM transaction_history WHERE user_id = $1');
            const incomeRes = await pool.query('SELECT SUM(amount) as total FROM transaction_history WHERE user_id = $1 AND amount > 0');
            const expenseRes = await pool.query('SELECT SUM(amount) as total FROM transaction_history WHERE user_id = $1 AND amount < 0');

            const total = totalRes.rows[0].total || 0;
            const totalIncome = incomeRes.rows[0].total || 0;
            const totalExpense = Math.abs(expenseRes.rows[0].total || 0);

            const historyRes = await pool.query(
                'SELECT amount, reason FROM transaction_history WHERE user_id = $1 ORDER BY id DESC LIMIT 5'
            );

            let historyText = historyRes.rows.map(item => {
                const icon = item.amount > 0 ? '🟢 +' : '🔴 ';
                return `${icon}${item.amount.toLocaleString('vi-VN')}đ - *${item.reason}*`;
            }).join('\n') || 'Hôm nay chưa có giao dịch nào.';

            const reportEmbed = new EmbedBuilder()
                .setColor(0x0099ff)
                .setTitle('💰 TÌNH HÌNH TÀI CHÍNH HÔM NAY')
                .addFields(
                    { name: 'Tổng Thu', value: `📈 ${totalIncome.toLocaleString('vi-VN')} VNĐ`, inline: true },
                    { name: 'Tổng Chi', value: `📉 ${totalExpense.toLocaleString('vi-VN')} VNĐ`, inline: true },
                    { name: 'Số Dư Hiện Tại', value: `💵 **${total.toLocaleString('vi-VN')} VNĐ**`, inline: false },
                    { name: '🕒 Các giao dịch gần nhất', value: historyText, inline: false }
                );
            return message.reply({ embeds: [reportEmbed] });
        } catch (err) {
            console.error(err);
            return message.reply('❌ Lỗi lấy dữ liệu báo cáo!');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

const app = express();
app.get('/', (req, res) => res.send('Bot hoạt động ổn định và tự động dọn dẹp cuối ngày!'));
const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`Cổng mạng đã mở tại port ${port}`));
