const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const fabricRoutes = require("./Router/fabricRouter");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(
  process.env.MONGO_URI
)
.then(() => console.log("✅ DB connected"))
.catch(console.error);

// Routes
app.use("/api/fabric", fabricRoutes);

// Port handling for Render
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
