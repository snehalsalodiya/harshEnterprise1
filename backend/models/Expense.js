const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['coated', 'washed', 'online maal','ink bill', 'salary', 'electric', 'other'],
    required: true
  },
  description: String,
  amount: Number,
  gst: Number,
  date: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Expense', expenseSchema);
