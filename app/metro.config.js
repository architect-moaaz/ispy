// Expo's default Metro config, plus binary glTF models as bundled assets (the operative in the 3D street).
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("glb");
module.exports = config;
