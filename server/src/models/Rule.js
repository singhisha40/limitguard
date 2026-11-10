const mongoose = require('mongoose');

const RuleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: /^[a-z0-9_-]{1,40}$/,
    },
    algorithm: {
      type: String,
      enum: ['token_bucket', 'sliding_window', 'fixed_window'],
      default: 'token_bucket',
    },
    limit: { type: Number, required: true, min: 1, max: 100000 },
    windowSec: { type: Number, required: true, min: 1, max: 86400 },
    keyBy: { type: String, enum: ['ip', 'apiKey'], default: 'ip' },
    enabled: { type: Boolean, default: true },
    description: { type: String, default: '', maxlength: 200 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Rule || mongoose.model('Rule', RuleSchema);
