// utils/sendWhatsAppPDF.js
const twilio = require("twilio");

const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

const client = twilio(accountSid, authToken);

const sendWhatsAppPDF = async (toNumber, billUrl, partyName, jobId) => {
  const to = `whatsapp:+91${toNumber}`;
  const message = `🧾 Hello ${partyName}, your bill for job ID *${jobId}* is ready. Please check the attached PDF.`;

  await client.messages.create({
    from: fromNumber,
    to,
    body: message,
    mediaUrl: [billUrl]
  });
};

module.exports = sendWhatsAppPDF;
