"use strict";
const path = require("path");
const { getDefaultDataDirectory } = require("./util");

const PUBLIC_PATH = path.resolve(__dirname, "..", "build");
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const SITE_TITLE = process.env.SITE_TITLE || "Dungeon Stealer";
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PC_PASSWORD = process.env.PC_PASSWORD || null;
const DM_PASSWORD = process.env.DM_PASSWORD || null;
const DATA_DIRECTORY = process.env.DATA_DIRECTORY || getDefaultDataDirectory();

module.exports = {
  DATA_DIRECTORY,
  PUBLIC_PATH,
  PUBLIC_URL,
  SITE_TITLE,
  PORT,
  HOST,
  PC_PASSWORD,
  DM_PASSWORD,
};
