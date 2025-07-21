const express = require("express");
const mongoose = require("mongoose"); const cors = 

require("cors");
const fabricRoutes = require("./Router/fabricRouter");
const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect("mongodb+srv://snehalsalodiya:snehal7850@cluster0.2xxvoht.mongodb.net/expanseDb?retryWrites=true&w=majority&appName=Cluster0").then(() => console.log("✅ DB connected")).catch(console.error);

app.use("/api/fabric", fabricRoutes);
app.listen(5000, () => console.log("🚀 Server running on port 5000"));