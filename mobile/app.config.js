const GOOGLE_SIGN_IN_PLUGIN = '@react-native-google-signin/google-signin';
const IOS_CLIENT_ID_SUFFIX = '.apps.googleusercontent.com';
const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
const iosClientIdPrefix = iosClientId?.endsWith(IOS_CLIENT_ID_SUFFIX)
  ? iosClientId.slice(0, -IOS_CLIENT_ID_SUFFIX.length)
  : 'ios-client-id-not-configured';

module.exports = ({ config }) => {
  const plugins = (config.plugins ?? []).filter((plugin) => {
    const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
    return pluginName !== GOOGLE_SIGN_IN_PLUGIN;
  });

  return {
    ...config,
    plugins: [
      ...plugins,
      [GOOGLE_SIGN_IN_PLUGIN, {
        iosUrlScheme: `com.googleusercontent.apps.${iosClientIdPrefix}`,
      }],
    ],
  };
};
