const mongoose = require('mongoose');

// ── Schemas ────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  email:      { type: String, required: true, unique: true, lowercase: true },
  password:   { type: String, required: true },
  role:       { type: String, default: 'user' },
  created_at: { type: Date, default: Date.now },
});

const contactSchema = new mongoose.Schema({
  name:       { type: String, required: true },
  email:      { type: String, required: true },
  subject:    { type: String, default: null },
  message:    { type: String, required: true },
  created_at: { type: Date, default: Date.now },
});

const subscriberSchema = new mongoose.Schema({
  email:      { type: String, required: true, unique: true, lowercase: true },
  name:       { type: String, default: null },
  subscribed: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});

const settingsSchema = new mongoose.Schema({
  key: { type: String, default: 'pricing', unique: true }, // singleton document, always 'pricing'
  simple_website: { type: Number, default: 500 },
  ecommerce:      { type: Number, default: 1500 },
  mobile_app:     { type: Number, default: 3000 },
  web_app:        { type: Number, default: 2000 },
  not_sure:       { type: Number, default: 500 },
  rushMultiplier: { type: Number, default: 1.4 },
  depositPercentage: { type: Number, default: 25 }, // % of the quote charged as an upfront deposit via Stripe
  updated_at:     { type: Date, default: Date.now },
});

const projectRequestSchema = new mongoose.Schema({
  clientName:       { type: String, required: true },
  clientEmail:      { type: String, required: true, lowercase: true },
  clientPhone:      { type: String, default: null },
  projectTitle:     { type: String, required: true },
  projectType:      { type: String, required: true }, // simple_website | ecommerce | mobile_app | web_app | not_sure
  description:      { type: String, required: true },
  features: {
    userAccounts:           { type: Boolean, default: false },
    payments:                { type: Boolean, default: false },
    adminPanel:              { type: Boolean, default: false },
    thirdPartyIntegrations:  { type: Boolean, default: false },
    fileUploads:              { type: Boolean, default: false },
    search:                   { type: Boolean, default: false },
    multiLanguage:            { type: Boolean, default: false },
    other:                    { type: String, default: null },
  },
  designReferences: { type: String, default: null },
  timeline:         { type: String, required: true }, // no_rush | two_to_four_weeks | rush
  budgetRange:      { type: String, default: null },
  additionalNotes:  { type: String, default: null },
  status:           { type: String, default: 'new' }, // new | quoted | accepted | rejected | in_progress | delivered
  quotedPrice:      { type: Number, default: null },
  quoteBreakdown:   { type: [{ label: String, amount: Number }], default: [] },
  quoteNotes:       { type: String, default: null },
  quoteFailed:      { type: Boolean, default: false },
  deliveredFiles:   { type: [{ filename: String, originalName: String, size: Number, mimetype: String, uploadedAt: Date }], default: [] },
  depositPaid:      { type: Boolean, default: false },
  depositAmount:    { type: Number, default: null }, // amount actually charged, in GBP
  stripeSessionId:  { type: String, default: null },
  paidAt:           { type: Date, default: null },

  // ── Budget negotiation (when a client clicks "Not right now" on the AI quote) ──
  negotiationStatus:  { type: String, default: 'none' }, // none | pending | countered | agreed
  clientBudget:       { type: Number, default: null }, // what the client said they can pay
  counterPrice:       { type: Number, default: null }, // the price you offer back, if you don't just accept theirs

  // ── Final payment (the remaining balance, charged once the project is delivered) ──
  fullPaymentPaid:      { type: Boolean, default: false },
  fullPaymentAmount:    { type: Number, default: null },
  fullPaymentSessionId: { type: String, default: null },
  fullPaidAt:           { type: Date, default: null },

  created_at:       { type: Date, default: Date.now },
});

const User       = mongoose.model('User', userSchema);
const Contact    = mongoose.model('Contact', contactSchema);
const Subscriber = mongoose.model('Subscriber', subscriberSchema);
const ProjectRequest = mongoose.model('ProjectRequest', projectRequestSchema);
const Settings = mongoose.model('Settings', settingsSchema);

module.exports = {
  async createUser({ name, email, password }) {
    return User.create({ name, email, password, role: 'user' });
  },
  async getUserByEmail(email) {
    return User.findOne({ email: email.toLowerCase() }).lean();
  },
  async getUserById(id) {
    return User.findById(id).lean();
  },

  async createContact({ name, email, subject, message }) {
    return Contact.create({ name, email, subject: subject || null, message });
  },
  async getContacts() {
    return Contact.find().sort({ created_at: -1 }).lean();
  },

  async getSubscriberByEmail(email) {
    return Subscriber.findOne({ email: email.toLowerCase() }).lean();
  },
  async createSubscriber({ email, name }) {
    return Subscriber.create({ email, name: name || null });
  },
  async resubscribe(email, name) {
    const update = { subscribed: true };
    if (name) update.name = name;
    return Subscriber.updateOne({ email: email.toLowerCase() }, update);
  },
  async unsubscribe(email) {
    const result = await Subscriber.updateOne(
      { email: email.toLowerCase() },
      { subscribed: false }
    );
    return result.modifiedCount;
  },
  async getSubscribers() {
    return Subscriber.find().sort({ created_at: -1 }).lean();
  },

  async createProjectRequest(data) {
    return ProjectRequest.create(data);
  },
  async getProjectRequests() {
    return ProjectRequest.find().sort({ created_at: -1 }).lean();
  },
  async getProjectRequestById(id) {
    return ProjectRequest.findById(id).lean();
  },
  async getProjectRequestsByEmail(email) {
    return ProjectRequest.find({ clientEmail: email.toLowerCase() })
      .select('projectTitle projectType status quotedPrice created_at')
      .sort({ created_at: -1 })
      .lean();
  },
  async updateProjectRequestStatus(id, status, quotedPrice) {
    const update = { status };
    if (quotedPrice !== undefined) update.quotedPrice = quotedPrice;
    return ProjectRequest.findByIdAndUpdate(id, update, { new: true }).lean();
  },
  async saveQuote(id, { quotedPrice, quoteBreakdown, quoteNotes }) {
    return ProjectRequest.findByIdAndUpdate(
      id,
      { status: 'quoted', quotedPrice, quoteBreakdown, quoteNotes, quoteFailed: false },
      { new: true }
    ).lean();
  },
  async markQuoteFailed(id) {
    return ProjectRequest.findByIdAndUpdate(id, { quoteFailed: true }, { new: true }).lean();
  },
  async respondToQuote(id, decision) {
    // decision must be 'accepted' or 'rejected'
    return ProjectRequest.findByIdAndUpdate(id, { status: decision }, { new: true }).lean();
  },
  async saveDeliveredFiles(id, files) {
    return ProjectRequest.findByIdAndUpdate(
      id,
      { status: 'delivered', deliveredFiles: files },
      { new: true }
    ).lean();
  },

  // Called from the Stripe webhook once a deposit Checkout session actually completes.
  async markDepositPaid(id, { amount, sessionId }) {
    return ProjectRequest.findByIdAndUpdate(
      id,
      { depositPaid: true, depositAmount: amount, stripeSessionId: sessionId, paidAt: new Date() },
      { new: true }
    ).lean();
  },

  // ── Budget negotiation ──────────────────────────────────────
  // Client clicked "Not right now" and typed in what they can actually pay.
  async proposeBudget(id, budget) {
    return ProjectRequest.findByIdAndUpdate(
      id,
      { negotiationStatus: 'pending', clientBudget: budget },
      { new: true }
    ).lean();
  },
  // You accept the client's proposed budget outright — it becomes the new quoted price.
  async acceptBudget(id) {
    const request = await ProjectRequest.findById(id);
    if (!request) return null;
    request.quotedPrice = request.clientBudget;
    request.status = 'accepted';
    request.negotiationStatus = 'agreed';
    await request.save();
    return request.toObject();
  },
  // You come back with a different number instead of accepting theirs.
  async counterBudget(id, counterPrice) {
    return ProjectRequest.findByIdAndUpdate(
      id,
      { counterPrice, negotiationStatus: 'countered' },
      { new: true }
    ).lean();
  },
  // Client accepts or declines your counter-offer.
  async respondToCounter(id, decision) {
    if (decision === 'accepted') {
      const request = await ProjectRequest.findById(id);
      if (!request) return null;
      request.quotedPrice = request.counterPrice;
      request.status = 'accepted';
      request.negotiationStatus = 'agreed';
      await request.save();
      return request.toObject();
    }
    return ProjectRequest.findByIdAndUpdate(id, { status: 'rejected' }, { new: true }).lean();
  },

  // ── Final payment ────────────────────────────────────────────
  // Called from the Stripe webhook once the remaining-balance Checkout session completes.
  async markFullPaymentPaid(id, { amount, sessionId }) {
    return ProjectRequest.findByIdAndUpdate(
      id,
      { fullPaymentPaid: true, fullPaymentAmount: amount, fullPaymentSessionId: sessionId, fullPaidAt: new Date() },
      { new: true }
    ).lean();
  },

  async getSettings() {
    let settings = await Settings.findOne({ key: 'pricing' }).lean();
    if (!settings) {
      settings = await Settings.create({ key: 'pricing' }); // creates with schema defaults
      settings = settings.toObject();
    }
    return settings;
  },
  async updateSettings(updates) {
    return Settings.findOneAndUpdate(
      { key: 'pricing' },
      { ...updates, updated_at: new Date() },
      { new: true, upsert: true }
    ).lean();
  },
};
