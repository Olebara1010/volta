// utils/projectOptions.js
// The choices on the project request form, shared by the request route and
// the AI brief assistant so they can never drift apart.

const PROJECT_TYPES = ['simple_website', 'ecommerce', 'web_app', 'mobile_app', 'not_sure'];
const TIMELINES = ['no_rush', 'two_to_four_weeks', 'rush'];
const FEATURE_FLAGS = ['userAccounts', 'payments', 'adminPanel', 'thirdPartyIntegrations', 'fileUploads', 'search', 'multiLanguage'];

module.exports = { PROJECT_TYPES, TIMELINES, FEATURE_FLAGS };
