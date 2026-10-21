// RTC-N2-02: extends app.json (all other values unchanged). google-services.json is NOT committed
// (public repo): EAS builds get it through the file env var GOOGLE_SERVICES_JSON; local builds use an
// untracked ./google-services.json (gitignored).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
