const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const express = require("express");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const API_DEVICE_ID = "esp32-mesa-01";
const API_EVENT_TYPE = "study.break.required";
const WS_PRODUCER_ID = process.env.WS_PRODUCER_ID || "consumidor-http-01";
const WS_URL = process.env.WS_CONSUMER_URL;
const WS_TOKEN = process.env.WS_PRODUCER_TOKEN;
const WS_TIMEOUT_MS = Number(process.env.WS_PUBLISH_TIMEOUT_MS || 60000);
const seenEvents = new Map();

function requireConfiguration() {
    const missing = [];
    if (!process.env.ESP32_TOKEN || process.env.ESP32_TOKEN.length < 32 || process.env.ESP32_TOKEN.includes("SUBSTITUA")) {
        missing.push("ESP32_TOKEN (gere um segredo aleatório com pelo menos 32 caracteres)");
    }
    if (!WS_URL) missing.push("WS_CONSUMER_URL");
    if (!WS_TOKEN || WS_TOKEN.length < 32 || WS_TOKEN.includes("SUBSTITUA")) {
        missing.push("WS_PRODUCER_TOKEN (gere outro segredo aleatório com pelo menos 32 caracteres)");
    }
    if (missing.length) {
        throw new Error(`Configure as variáveis obrigatórias: ${missing.join(", ")}`);
    }
    if (new URL(WS_URL).protocol !== "wss:") {
        throw new Error("WS_CONSUMER_URL precisa usar wss:// para proteger o canal WebSocket.");
    }
}

function secureTokenMatches(received, expected) {
    if (typeof received !== "string" || typeof expected !== "string") return false;
    const receivedBytes = Buffer.from(received);
    const expectedBytes = Buffer.from(expected);
    return receivedBytes.length === expectedBytes.length
        && crypto.timingSafeEqual(receivedBytes, expectedBytes);
}

function bearerToken(request) {
    const match = /^Bearer\s+(.+)$/i.exec(request.get("authorization") || "");
    return match ? match[1] : "";
}

function rememberEvent(eventId, receipt) {
    seenEvents.set(eventId, receipt);
    if (seenEvents.size > 1000) {
        seenEvents.delete(seenEvents.keys().next().value);
    }
}

function makeNotification(event) {
    return {
        schemaVersion: 1,
        eventId: `notification-${event.eventId}`,
        sourceEventId: event.eventId,
        deviceId: WS_PRODUCER_ID,
        eventType: "study.break.notification",
        state: event.state,
        message: "Hora da pausa para o lanche!",
        createdAt: new Date().toISOString()
    };
}

function publishToWebSocket(event) {
    return new Promise((resolve, reject) => {
        let completed = false;
        const ca = process.env.WS_CA_CERT
            ? fs.readFileSync(process.env.WS_CA_CERT)
            : undefined;
        const options = {
            headers: { Authorization: `Bearer ${WS_TOKEN}` },
            rejectUnauthorized: true
        };
        if (ca) options.ca = ca;

        const socket = new WebSocket(WS_URL, options);
        const timeout = setTimeout(() => finish(new Error("Tempo esgotado aguardando confirmação WebSocket.")), WS_TIMEOUT_MS);

        function finish(error, receipt) {
            if (completed) return;
            completed = true;
            clearTimeout(timeout);
            if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
                socket.terminate();
            }
            if (error) reject(error);
            else resolve(receipt);
        }

        socket.once("open", () => {
            socket.send(JSON.stringify(event), (error) => {
                if (error) finish(error);
            });
        });

        socket.on("message", (raw) => {
            let ack;
            try {
                ack = JSON.parse(raw.toString());
            } catch {
                return finish(new Error("O consumidor WebSocket retornou uma confirmação inválida."));
            }

            if (ack.eventId !== event.eventId) return;
            if (ack.consumerId !== "websocket-consumer-01") {
                return finish(new Error("Identidade do consumidor WebSocket inválida."));
            }
            if (ack.status !== "accepted" && ack.status !== "duplicate") {
                return finish(new Error(`Publicação WebSocket rejeitada: ${ack.reason || ack.status}.`));
            }
            finish(null, ack);
        });

        socket.once("error", (error) => finish(error));
        socket.once("close", () => {
            if (!completed) finish(new Error("Conexão WebSocket encerrada antes da confirmação."));
        });
    });
}

function validateEvent(event, request) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
        return "O corpo precisa ser um objeto JSON.";
    }
    if (event.schemaVersion !== 2) return "schemaVersion precisa ser 2.";
    if (typeof event.eventId !== "string" || !/^[A-Za-z0-9._:-]{1,100}$/.test(event.eventId)) {
        return "eventId ausente ou inválido.";
    }
    if (request.get("x-device-id") !== API_DEVICE_ID || event.deviceId !== API_DEVICE_ID) {
        return "A identidade do dispositivo não corresponde à credencial.";
    }
    if (event.eventType !== API_EVENT_TYPE) return "O dispositivo não tem permissão para publicar este tipo de evento.";
    if (event.state !== "PAUSA_RECOMENDADA") return "state inválido para este tipo de evento.";
    if (event.sensorConfirmacao !== "ultrassonico+camera") return "sensorConfirmacao inválido.";
    return null;
}

requireConfiguration();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "4kb", strict: true }));
app.use((request, response, next) => {
    if (process.env.NODE_ENV === "production" && !request.secure) {
        return response.status(426).json({ error: "Use HTTPS." });
    }
    next();
});

app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
});

app.post("/api/v1/eventos", async (request, response) => {
    if (!secureTokenMatches(bearerToken(request), process.env.ESP32_TOKEN)) {
        return response.status(401).json({ error: "Credencial ausente ou inválida." });
    }

    const invalidReason = validateEvent(request.body, request);
    if (invalidReason) {
        return response.status(403).json({ error: invalidReason });
    }

    const event = request.body;
    const previousReceipt = seenEvents.get(event.eventId);
    if (previousReceipt) {
        return response.status(200).json({
            status: "recebido",
            eventId: event.eventId,
            downstream: previousReceipt.status,
            duplicate: true
        });
    }

    const notification = makeNotification(event);
    try {
        const receipt = await publishToWebSocket(notification);
        rememberEvent(event.eventId, receipt);

        console.log("\n=== EVENTO RECEBIDO ===");
        console.log("Versão do contrato:", event.schemaVersion);
        console.log("ID:", event.eventId);
        console.log("Dispositivo autenticado:", API_DEVICE_ID);
        console.log("Tipo autorizado:", event.eventType);
        console.log("Estado:", event.state);
        console.log("Confirmação de sensores:", event.sensorConfirmacao);
        console.log("Publicado por WebSocket:", notification.eventId);
        console.log("Confirmação do consumidor:", receipt.status);
        console.log("=======================\n");

        return response.status(200).json({
            status: "recebido",
            eventId: event.eventId,
            downstream: receipt.status,
            downstreamEventId: notification.eventId
        });
    } catch (error) {
        console.error("Falha ao publicar no consumidor WebSocket:", error.message);
        return response.status(503).json({
            error: "O consumidor WebSocket não confirmou o evento; tente novamente com o mesmo eventId."
        });
    }
});

const tlsKey = process.env.TLS_KEY_PATH;
const tlsCert = process.env.TLS_CERT_PATH;
if (Boolean(tlsKey) !== Boolean(tlsCert)) {
    throw new Error("Defina TLS_KEY_PATH e TLS_CERT_PATH juntos, ou deixe ambos vazios.");
}

const server = tlsKey
    ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, app)
    : http.createServer(app);

server.listen(PORT, process.env.HOST || "0.0.0.0", () => {
    const protocol = tlsKey ? "HTTPS" : "HTTP atrás do proxy TLS / localhost";
    console.log(`API consumidora (${protocol}) executando na porta ${PORT}`);
    console.log("Aguardando eventos autenticados do ESP32 e confirmação via WebSocket...");
});
