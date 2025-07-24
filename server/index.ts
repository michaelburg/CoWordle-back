import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import words from "an-array-of-english-words";

const app = express();
const server = createServer(app);

const allowedOrigins = [
  "http://localhost:3000",
  "https://michaelburg.github.io",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(express.json());

interface GameState {
  currentWord: string;
  guesses: string[];
  currentGuess: string;
  gameStatus: "playing" | "won" | "lost";
  maxGuesses: number;
}

interface Player {
  id: string;
  name: string;
  gameState: GameState;
  hasWon: boolean;
}

interface GameSession {
  id: string;
  players: Player[];
  createdAt: Date;
  gameEnded: boolean;
  winner?: string;
  hostId?: string;
  gameStarted: boolean;
}

const gameSessions = new Map<string, GameSession>();

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

const FIVE_LETTER_WORDS = words
  .filter((word: string) => word.length === 5)
  .map((word: string) => word.toUpperCase());

function getRandomWord(): string {
  return FIVE_LETTER_WORDS[
    Math.floor(Math.random() * FIVE_LETTER_WORDS.length)
  ];
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
      const sharedWord =
        session.players.length > 0
          ? session.players[0].gameState.currentWord
          : getRandomWord();

      player = {
        id: socket.id,
        name: playerName,
        gameState: {
          ...gameState,
          currentWord: sharedWord,
        },
        hasWon: false,
      };
      session.players.push(player);

      if (session.players.length === 1) {
        session.hostId = socket.id;
      }
    } else if (player) {
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
        } else if (!session.gameEnded) {
          const allPlayersFinished = session.players.every(
            (p) =>
              p.gameState.gameStatus === "lost" ||
              p.gameState.gameStatus === "won"
          );
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
        } else {
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

app.get("/health", (_req: express.Request, res: express.Response) => {
  res.json({ status: "OK", sessions: gameSessions.size });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
