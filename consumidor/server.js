const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post("/api/v1/eventos", (req, res) => {
    const evento = req.body;

    console.log("\n=== EVENTO RECEBIDO ===");
    console.log("ID:", evento.eventId);
    console.log("Dispositivo:", evento.deviceId);
    console.log("Tipo:", evento.eventType);
    console.log("Estado:", evento.state);
    console.log("Confirmação de sensores:", evento.sensorConfirmacao || "não informado");
    console.log("=======================\n");

    res.status(200).json({
        status: "recebido",
        eventId: evento.eventId
    });
});

app.listen(PORT, () => {
    console.log(`Consumidor executando na porta ${PORT}`);
    console.log("Aguardando eventos...");
});