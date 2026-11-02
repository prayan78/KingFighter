import { Schema, model, models } from 'mongoose'
import { currentSeason } from '../ranked.ts'

const layoutValue = new Schema({
  x: { type: Number, min: 0.02, max: 0.98, required: true },
  y: { type: Number, min: 0.04, max: 0.96, required: true },
  size: { type: Number, min: 0.55, max: 1.5, required: true },
  opacity: { type: Number, min: 0.25, max: 1, required: true },
}, { _id: false })

const layoutSchema = new Schema({
  joystick: { type: layoutValue, required: true }, attack: { type: layoutValue, required: true },
  skill1: { type: layoutValue, required: true }, skill2: { type: layoutValue, required: true },
  skill3: { type: layoutValue, required: true }, ultimate: { type: layoutValue, required: true }, dash: { type: layoutValue, required: true },
}, { _id: false })

const playerSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20, lowercase: true },
  displayName: { type: String, required: true, trim: true, maxlength: 24 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  ownedHeroes: { type: [String], enum: ['kai', 'nyx'], default: ['kai', 'nyx'] },
  selectedHero: { type: String, enum: ['kai', 'nyx'], default: 'kai' },
  experience: { type: Number, min: 0, default: 0 },
  seasonId: { type: String, default: () => currentSeason().id, maxlength: 16 },
  seasonRating: { type: Number, min: 0, max: 10000, default: 1000 },
  seasonPeakRating: { type: Number, min: 0, max: 10000, default: 1000 },
  seasonExperience: { type: Number, min: 0, default: 0 },
  seasonMatches: { type: Number, min: 0, default: 0 },
  seasonWins: { type: Number, min: 0, default: 0 },
  achievements: { type: [String], default: [] },
  matchHistory: [{
    heroId: { type: String, enum: ['kai', 'nyx'], required: true },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'online'], required: true },
    result: { type: String, enum: ['win', 'loss'], required: true },
    roundsWon: { type: Number, min: 0, max: 2, required: true }, roundsLost: { type: Number, min: 0, max: 2, required: true },
    opponent: { type: String, maxlength: 24 },
    seasonId: { type: String, maxlength: 16 }, ratingChange: { type: Number, min: -50, max: 50 }, ranked: { type: Boolean, default: false },
    playedAt: { type: Date, default: Date.now },
  }],
  controlLayout: { type: layoutSchema, default: undefined },
}, { timestamps: true, versionKey: false })

export const Player = models.Player || model('Player', playerSchema)
