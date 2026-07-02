const nodemailer = require('nodemailer');
require('dotenv').config();


const transporter = nodemailer.createTransport({
    host: 'sandbox.smtp.mailtrap.io',
    port: 2525,
    auth: {
        user: '11e98266eec46d',
        pass: '3a19facb0b03fb'  
    },
});

// Correo de destino para la alerta
const ALERT_EMAIL_DESTINATION = 'aifindops08@gmail.com';

async function sendBudgetEmail({ consumerId, level, message }) {
    console.log(`[EMAIL PROCESS] 📩 Intentando enviar correo para ${consumerId}...`);

    const subjectMap = {
        warning: `[FinOps Alerta] Umbral de Advertencia - Consumidor: ${consumerId}`,
        critical: `[FinOps CRÍTICO] Umbral Superado - Consumidor: ${consumerId}`,
        blocked: `[FinOps BLOQUEO] Presupuesto Agotado - Consumidor: ${consumerId}`
    };

    const mailOptions = {
        from: '"AI FinOps Proxy" <no-reply@finops-proxy.local>',
        to: ALERT_EMAIL_DESTINATION,
        subject: subjectMap[level] || `🔔 [FinOps Notificación] ${level.toUpperCase()}`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
                <h2 style="color: ${level === 'blocked' ? '#d9534f' : level === 'critical' ? '#f0ad4e' : '#5bc0de'};">
                    Alerta de Sistema FinOps: ${level.toUpperCase()}
                </h2>
                <p><strong>Consumidor ID:</strong> ${consumerId}</p>
                <p><strong>Mensaje:</strong> ${message}</p>
                <hr style="border: 0; border-top: 1px solid #eee;" />
                <p style="font-size: 12px; color: #777;">Este es un mensaje automático generado por el Proxy de Inteligencia Artificial.</p>
            </div>
        `,
    };

try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[EMAIL SUCCESS] ✅ Correo enviado con éxito. ID: ${info.messageId}`);
        return info;
    } catch (error) {
        console.error(`[EMAIL ERROR] ❌ Error enviando correo a Mailtrap:`, error.message);
    }

}


module.exports = { sendBudgetEmail };