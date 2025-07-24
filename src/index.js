"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
// @ts-ignore
const an_array_of_english_words_1 = __importDefault(require("an-array-of-english-words"));
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const allowedOrigins = [
    "http://localhost:3000",
    "https://michaelburg.github.io",
];
app.use((0, cors_1.default)({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
}));
const io = new socket_io_1.Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
    },
});
app.use(express_1.default.json());
const gameSessions = new Map();
const cleanupSessions = () => {
    const now = new Date();
    const dayInMs = 24 * 60 * 60 * 1000;
    for (const [sessionId, session] of gameSessions.entries()) {
        if (now.getTime() - session.createdAt.getTime() > dayInMs) {
            gameSessions.delete(sessionId);
        }
    }
};
setInterval(cleanupSessions, 60 * 60 * 1000);
const FIVE_LETTER_WORDS = an_array_of_english_words_1.default
    .filter((word) => word.length === 5)
    .map((word) => word.toUpperCase());
function getRandomWord() {
    return FIVE_LETTER_WORDS[Math.floor(Math.random() * FIVE_LETTER_WORDS.length)];
}
io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    socket.on("join-session", (data) => {
        const { sessionId, playerName, gameState } = data;
        let session = gameSessions.get(sessionId);
        if (!session) {
            session = {
                id: sessionId,
                players: [],
                createdAt: new Date(),
                gameEnded: false,
                gameStarted: false,
            };
            gameSessions.set(sessionId, session);
        }
        let player = session.players.find((p) => p.name === playerName);
        if (!player && session.players.length < 2) {
            const sharedWord = session.players.length > 0
                ? session.players[0].gameState.currentWord
                : getRandomWord();
            player = {
                id: socket.id,
                name: playerName,
                gameState: Object.assign(Object.assign({}, gameState), { currentWord: sharedWord }),
                hasWon: false,
            };
            session.players.push(player);
            if (session.players.length === 1) {
                session.hostId = socket.id;
            }
        }
        else if (player) {
            player.id = socket.id;
            if (session.hostId === socket.id || !session.hostId) {
                session.hostId = socket.id;
            }
        }
        socket.join(sessionId);
        io.to(sessionId).emit("session-update", {
            players: session.players,
            gameEnded: session.gameEnded,
            winner: session.winner,
            hostId: session.hostId,
            gameStarted: session.gameStarted,
        });
    });
    socket.on("start-game", (data) => {
        const { sessionId } = data;
        const session = gameSessions.get(sessionId);
        if (session && session.hostId === socket.id && !session.gameStarted) {
            session.gameStarted = true;
            io.to(sessionId).emit("game-started", {
                gameStarted: true,
            });
            io.to(sessionId).emit("session-update", {
                players: session.players,
                gameEnded: session.gameEnded,
                winner: session.winner,
                hostId: session.hostId,
                gameStarted: session.gameStarted,
            });
        }
    });
    socket.on("game-update", (data) => {
        const { sessionId, playerName, gameState, hasWon } = data;
        const session = gameSessions.get(sessionId);
        if (session && session.gameStarted) {
            const player = session.players.find((p) => p.name === playerName);
            if (player) {
                player.gameState = gameState;
                player.hasWon = hasWon;
                if (hasWon && !session.gameEnded) {
                    session.gameEnded = true;
                    session.winner = playerName;
                    io.to(sessionId).emit("game-ended", {
                        winner: playerName,
                        sessionEnded: true,
                        reason: "winner",
                    });
                }
                else if (!session.gameEnded) {
                    const allPlayersFinished = session.players.every((p) => p.gameState.gameStatus === "lost" ||
                        p.gameState.gameStatus === "won");
                    const anyPlayerWon = session.players.some((p) => p.hasWon);
                    if (allPlayersFinished && !anyPlayerWon) {
                        session.gameEnded = true;
                        session.winner = undefined;
                        io.to(sessionId).emit("game-ended", {
                            winner: null,
                            sessionEnded: true,
                            reason: "everyone-lost",
                        });
                    }
                }
                io.to(sessionId).emit("session-update", {
                    players: session.players,
                    gameEnded: session.gameEnded,
                    winner: session.winner,
                    hostId: session.hostId,
                    gameStarted: session.gameStarted,
                });
            }
        }
    });
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
        for (const [sessionId, session] of gameSessions.entries()) {
            const playerIndex = session.players.findIndex((p) => p.id === socket.id);
            if (playerIndex !== -1) {
                session.players.splice(playerIndex, 1);
                if (session.hostId === socket.id && session.players.length > 0) {
                    session.hostId = session.players[0].id;
                }
                if (session.players.length === 0) {
                    gameSessions.delete(sessionId);
                }
                else {
                    io.to(sessionId).emit("session-update", {
                        players: session.players,
                        gameEnded: session.gameEnded,
                        winner: session.winner,
                        hostId: session.hostId,
                        gameStarted: session.gameStarted,
                    });
                }
                break;
            }
        }
    });
});
app.get("/health", (_req, res) => {
    res.json({ status: "OK", sessions: gameSessions.size });
});
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
