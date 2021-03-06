// @ts-check
const fetch = require("node-fetch").default;
const { MemCache } = require("../../utils/mem-cache.js");
const { env, ms, seconds, HTTPError } = require("../../utils/misc.js");
const groups = require("./groups.json");

const API_KEY = env("W3C_API_KEY");

/**
 * @typedef {object} Group
 * @property {number} Group.id
 * @property {string} Group.shortname
 * @property {"wg" | "cg"} Group.type
 * @property {string} Group.name
 * @property {string} [Group.URI]
 * @property {string} [Group.patentURI]
 * @property {"PP2017" | "PP2020" | null} [Group.patentPolicy]
 */
/** @type {MemCache<Group>} */
const cache = new MemCache(ms("2 weeks"));

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
module.exports.route = async function route(req, res) {
  const { groupName } = req.params;
  if (!groupName) {
    const data = await getAllGroupInfo();
    if (req.headers.accept.includes("text/html")) {
      return res.render("w3c/groups.js", { groups: data });
    }
    return res.json(data);
  }

  try {
    const groupInfo = await getGroupInfo(groupName);
    res.set("Cache-Control", `max-age=${seconds("24h")}`);
    res.json(groupInfo);
  } catch (error) {
    const { statusCode, message } = error;
    res.set("Content-Type", "text/plain");
    res.status(statusCode).send(message);
  }
};

/**
 * @param {string} groupName
 */
async function getGroupInfo(groupName) {
  let groupInfo = cache.get(groupName);
  if (groupInfo) {
    return groupInfo;
  }

  const { id: groupId, type: groupType } = getGroupMeta(groupName);
  if (!groupId) {
    throw new HTTPError(404, `No group with groupName: ${groupName}`);
  }

  groupInfo = await fetchGroupInfo(groupId, groupName, groupType);
  cache.set(groupName, groupInfo);
  return groupInfo;
}

async function getAllGroupInfo() {
  const allGroupNames = Object.values(groups).flatMap(g => Object.keys(g));
  await Promise.allSettled(allGroupNames.map(getGroupInfo)); // fill cache
  return allGroupNames.map(name => cache.get(name) || getGroupMeta(name));
}

/**
 * @param {number} id
 * @param {string} shortname
 * @param {Group["type"]} type
 * @returns {Promise<Group>}
 */
async function fetchGroupInfo(id, shortname, type) {
  const url = new URL(id.toString(), "https://api.w3.org/groups/");
  url.searchParams.set("apikey", API_KEY);

  const res = await fetch(url);
  if (!res.ok) {
    throw new HTTPError(res.status, res.statusText);
  }
  const json = await res.json();

  const { name, _links: links } = json;

  const patentPolicy = links["active-charter"]?.href
    ? await getPatentPolicy(links["active-charter"].href)
    : undefined;

  return {
    shortname,
    type,
    id,
    name,
    URI: links.homepage?.href,
    patentURI: links["pp-status"]?.href,
    patentPolicy,
  };
}

/** @param {string} activeCharterApiUrl */
async function getPatentPolicy(activeCharterApiUrl) {
  const url = new URL(activeCharterApiUrl);
  url.searchParams.set("apikey", API_KEY);

  const res = await fetch(url);
  const { ["patent-policy"]: patentPolicyURL } = await res.json();

  if (!patentPolicyURL || typeof patentPolicyURL !== "string") {
    return null;
  } else if (patentPolicyURL.includes("Patent-Policy-2017")) {
    return "PP2017";
  } else {
    return "PP2020";
  }
}

/** @param {string} shortname */
function getGroupMeta(shortname) {
  /** @type {number} */
  let id;
  /** @type {Group["type"]} */
  let type;

  if (groups.wg.hasOwnProperty(shortname)) {
    [type, id] = ["wg", groups.wg[shortname]];
  } else if (groups.cg.hasOwnProperty(shortname)) {
    [type, id] = ["cg", groups.cg[shortname]];
  }

  return { shortname, type, id };
}
