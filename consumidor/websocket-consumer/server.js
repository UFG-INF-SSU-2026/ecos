const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.WS_PORT || process.env.PORT || 3001);
const PATH = "/api/v1/publicacoes";
const PRODUCER_ID = process.env.WS_PRODUCER_ID || "consumidor-http-01";
const CONSUMER_ID = "websocket-consumer-01";
const EVENT_TYPE = "study.break.notification";
const TOKEN = process.env.WS_PRODUCER_TOKEN;
const seenEvents = new Map();

if (!TOKEN || TOKEN.length < 32 || TOKEN.includes("SUBSTITUA")) {
    throw new Error("Configure WS_PRODUCER_TOKEN com um segredo aleatório de pelo menos 32 caracteres.");
}

function secureTokenMatches(received, expected) {
    if (typeof received !== "string" || typeof expected !== "string") return false;
    const receivedBytes = Buffer.from(received);
    const expectedBytes = Buffer.from(expected);
    return receivedBytes.length === expectedBytes.length
        && crypto.timingSafeEqual(receivedBytes, expectedBytes);
}

function bearerToken(request) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || "");
    return match ? match[1] : "";
}

function rejectUpgrade(socket, status, message) {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
}

function validPublication(event) {
    return event
        && typeof event === "object"
        && !Array.isArray(event)
        && event.schemaVersion === 1
        && typeof event.eventId === "string"
        && /^[A-Za-z0-9._:-]{1,120}$/.test(event.eventId)
        && typeof event.sourceEventId === "string"
        && event.eventId === `notification-${event.sourceEventId}`
        && event.deviceId === PRODUCER_ID
        && event.eventType === EVENT_TYPE
        && event.state === "PAUSA_RECOMENDADA"
        && event.message === "Hora da pausa para o lanche!"
        && typeof event.createdAt === "string"
        && !Number.isNaN(Date.parse(event.createdAt));
}

function rememberEvent(eventId) {
    seenEvents.set(eventId, true);
    if (seenEvents.size > 1000) {
        seenEvents.delete(seenEvents.keys().next().value);
    }
}

const app = express();
app.disable("x-powered-by");
app.get("/health", (_request, response) => {
    response.json({ status: "ok", consumerId: CONSUMER_ID });
});

const tlsKey = process.env.TLS_KEY_PATH;
const tlsCert = process.env.TLS_CERT_PATH;
if (Boolean(tlsKey) !== Boolean(tlsCert)) {
    throw new Error("Defina TLS_KEY_PATH e TLS_CERT_PATH juntos, ou deixe ambos vazios.");
}

const server = tlsKey
    ? https.createServer({ key: fs.readFileSync(tlsKey), cert: fs.readFileSync(tlsCert) }, app)
    : http.createServer(app);

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const forwardedProtocols = String(request.headers["x-forwarded-proto"] || "")
        .split(",").map((protocol) => protocol.trim().toLowerCase());
    if (process.env.NODE_ENV === "production" && !forwardedProtocols.includes("https")) {
        return rejectUpgrade(socket, "426 Upgrade Required", "Use WSS");
    }
    if (pathname !== PATH) {
        return rejectUpgrade(socket, "404 Not Found", "Not Found");
    }
    if (!secureTokenMatches(bearerToken(request), TOKEN)) {
        return rejectUpgrade(socket, "401 Unauthorized", "Unauthorized");
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocket.producerDeviceId = PRODUCER_ID;
        webSocketServer.emit("connection", webSocket, request);
    });
});

webSocketServer.on("connection", (webSocket) => {
    console.log(`Produtor autenticado conectado: ${PRODUCER_ID}`);

    webSocket.on("message", (raw) => {
        let event;
        try {
            event = JSON.parse(raw.toString());
        } catch {
            webSocket.send(JSON.stringify({ type: "error", reason: "invalid_json" }));
            return;
        }

        if (!validPublication(event) || event.deviceId !== webSocket.producerDeviceId) {
            webSocket.send(JSON.stringify({
                type: "ack",
                eventId: event && event.eventId,
                status: "rejected",
                reason: "unauthorized_publication"
            }));
            console.warn("Publicação rejeitada: identidade, tipo ou contrato não autorizado.");
            return;
        }

        if (seenEvents.has(event.eventId)) {
            webSocket.send(JSON.stringify({
                type: "ack",
                eventId: event.eventId,
                status: "duplicate",
                consumerId: CONSUMER_ID
            }));
            return;
        }

        rememberEvent(event.eventId);
        console.log("\n=== PUBLICAÇÃO WEBSOCKET RECEBIDA ===");
        console.log("Consumidor autenticado:", CONSUMER_ID);
        console.log("Produtor autenticado:", webSocket.producerDeviceId);
        console.log("ID:", event.eventId);
        console.log("Evento de origem:", event.sourceEventId);
        console.log("Tipo autorizado:", event.eventType);
        console.log("Mensagem:", event.message);
        console.log("=====================================\n");

        webSocket.send(JSON.stringify({
            type: "ack",
            eventId: event.eventId,
            status: "accepted",
            consumerId: CONSUMER_ID
        }));
    });

    webSocket.on("close", () => console.log(`Produtor desconectado: ${PRODUCER_ID}`));
});

server.listen(PORT, process.env.HOST || "0.0.0.0", () => {
    const protocol = tlsKey ? "WSS" : "WS atrás do proxy TLS / localhost";
    console.log(`Consumidor WebSocket (${protocol}) executando na porta ${PORT}`);
    console.log(`Endpoint: ${PATH}`);
});
