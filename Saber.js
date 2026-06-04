/**
 * DomainFront Relay — Google Apps Script (Stable Version)
 * 
 * NOTE: This is a general-purpose HTTP relay script for legitimate use cases
 * such as API aggregation, content caching, and request proxying for authorized
 * services. Use responsibly and in compliance with Google Apps Script terms of service.
 */

const AUTH_KEY = "CHANGE_ME_TO_A_STRONG_SECRET";
const DIAGNOSTIC_MODE = false;

// ── Optional Spreadsheet Cache ──────────────────────────────
const CACHE_SPREADSHEET_ID = "CHANGE_ME_TO_CACHE_SPREADSHEET_ID";
const CACHE_SHEET_NAME = "RelayCache";
const CACHE_META_SHEET_NAME = "RelayMeta";
const CACHE_META_CURSOR_CELL = "A1";

// ── Cache Tuning ────────────────────────────────────────────
const CACHE_MAX_ROWS = 5000;
const CACHE_MAX_BODY_BYTES = 35000;
const CACHE_DEFAULT_TTL_SECONDS = 86400;
const NEGATIVE_CACHE_STATUSES = { 404: 1, 410: 1, 451: 1 };
const NEGATIVE_CACHE_TTL_SECONDS = 300;
const GZIP_MIN_BYTES = 256;
const VARY_KEY_HEADERS = ["accept-encoding", "accept-language"];

const SKIP_HEADERS = {
  host: 1, connection: 1, "content-length": 1,
  "transfer-encoding": 1, "proxy-connection": 1, "proxy-authorization": 1,
  "priority": 1, te: 1,
  "x-forwarded-for": 1, "x-forwarded-host": 1, "x-forwarded-proto": 1,
  "x-forwarded-port": 1, "x-real-ip": 1, "forwarded": 1, "via": 1,
};

const SAFE_REPLAY_METHODS = { GET: 1, HEAD: 1, OPTIONS: 1 };
const CACHE_BUSTING_HEADERS = {
  authorization: 1, cookie: 1, "x-api-key": 1,
  "proxy-authorization": 1, "set-cookie": 1,
};

const DECOY_HTML =
  '<!DOCTYPE html><html><head><title>Web App</title></head>' +
  '<body><p>The script completed but did not return anything.</p>' +
  '</body></html>';

// ═══════════════════════════════════════════════════════════
//  REQUEST COUNTER — PERSISTENT PROPERTIES STORE
// ═══════════════════════════════════════════════════════════

const PROP_TOTAL_REQUESTS = "TOTAL_REQUESTS_COUNTER";
const PROP_DAILY_REQUESTS = "DAILY_REQUESTS_COUNTER";
const PROP_LAST_RESET_DATE = "LAST_RESET_DATE";

function _getTodayDate() {
  var now = new Date();
  var iranTime = new Date(now.getTime() + (3.5 * 60 * 60 * 1000));
  return iranTime.toISOString().split('T')[0];
}

function _resetDailyCounterIfNeeded() {
  var props = PropertiesService.getScriptProperties();
  var lastReset = props.getProperty(PROP_LAST_RESET_DATE);
  var today = _getTodayDate();
  
  if (lastReset !== today) {
    props.setProperty(PROP_DAILY_REQUESTS, "0");
    props.setProperty(PROP_LAST_RESET_DATE, today);
  }
}

function _incrementRequestCounter() {
  try {
    var props = PropertiesService.getScriptProperties();
    _resetDailyCounterIfNeeded();
    
    var totalStr = props.getProperty(PROP_TOTAL_REQUESTS);
    var total = totalStr ? parseInt(totalStr, 10) : 0;
    total++;
    props.setProperty(PROP_TOTAL_REQUESTS, total.toString());
    
    var dailyStr = props.getProperty(PROP_DAILY_REQUESTS);
    var daily = dailyStr ? parseInt(dailyStr, 10) : 0;
    daily++;
    props.setProperty(PROP_DAILY_REQUESTS, daily.toString());
    
    if (total % 100 === 0) {
      console.log("Total requests reached: " + total);
    }
    
    return { total: total, daily: daily };
  } catch (err) {
    console.error("Failed to increment counter: " + err);
    return null;
  }
}

function getRequestStats() {
  try {
    var props = PropertiesService.getScriptProperties();
    _resetDailyCounterIfNeeded();
    
    var totalStr = props.getProperty(PROP_TOTAL_REQUESTS);
    var dailyStr = props.getProperty(PROP_DAILY_REQUESTS);
    
    return {
      total: totalStr ? parseInt(totalStr, 10) : 0,
      daily: dailyStr ? parseInt(dailyStr, 10) : 0,
      lastReset: props.getProperty(PROP_LAST_RESET_DATE) || "Never",
      cacheEnabled: (CACHE_SPREADSHEET_ID !== "CHANGE_ME_TO_CACHE_SPREADSHEET_ID"),
      diagnosticMode: DIAGNOSTIC_MODE
    };
  } catch (err) {
    return { error: String(err) };
  }
}

function resetTotalCounter() {
  var props = PropertiesService.getScriptProperties();
  var before = props.getProperty(PROP_TOTAL_REQUESTS) || "0";
  props.setProperty(PROP_TOTAL_REQUESTS, "0");
  console.log("TOTAL COUNTER RESET: was " + before + ", now 0");
}

// ═══════════════════════════════════════════════════════════
//  END REQUEST COUNTER
// ═══════════════════════════════════════════════════════════

function _decoyOrError(jsonBody) {
  if (DIAGNOSTIC_MODE) return _json(jsonBody);
  return ContentService.createTextOutput(DECOY_HTML).setMimeType(ContentService.MimeType.HTML);
}

function doPost(e) {
  try {
    _incrementRequestCounter();
    var req = JSON.parse(e.postData.contents);
    if (req.k !== AUTH_KEY) return _decoyOrError({ e: "unauthorized" });
    if (Array.isArray(req.q)) return _doBatch(req.q);
    return _doSingle(req);
  } catch (err) {
    return _decoyOrError({ e: String(err) });
  }
}

function doGet(e) {
  _incrementRequestCounter();
  return ContentService.createTextOutput(DECOY_HTML).setMimeType(ContentService.MimeType.HTML);
}

function doGetStats() {
  var stats = getRequestStats();
  return ContentService
    .createTextOutput(JSON.stringify(stats, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Single Request ─────────────────────────────────────────

function _doSingle(req) {
  var startTime = Date.now();
  
  if (!req.u || typeof req.u !== "string" || !req.u.match(/^https?:\/\//i)) {
    return _json({ e: "bad url" });
  }

  // ── Optional cache path ────────────────────────────────
  if (_canUseCache(req)) {
    var cached = _getFromCache(req.u, req.h);
    if (cached) {
      console.log("Cache HIT for: " + req.u.substring(0, 100));
      return _json({
        s: cached.status,
        h: JSON.parse(cached.headers),
        b: cached.body,
        cached: true,
      });
    }

    var fetchResult = _fetchAndCache(req.u, req.h);
    if (fetchResult) {
      console.log("Cache MISS for: " + req.u.substring(0, 100) + " (stored)");
      return _json({
        s: fetchResult.status,
        h: JSON.parse(fetchResult.headers),
        b: fetchResult.body,
        cached: false,
      });
    }
  }

  // ── Normal relay ────────────────────────────────────────
  try {
    var opts = _buildOpts(req);
    var fetchStart = Date.now();
    var resp = UrlFetchApp.fetch(req.u, opts);
    var fetchDuration = Date.now() - fetchStart;
    
    var responseSize = resp.getContent().length;
    console.log("Fetch completed: " + fetchDuration + " ms, status: " + 
                resp.getResponseCode() + ", size: " + responseSize + " bytes");
    
    return _json({
      s: resp.getResponseCode(),
      h: _respHeaders(resp),
      b: Utilities.base64Encode(resp.getContent()),
    });
  } catch (err) {
    console.error("Fetch failed for " + req.u.substring(0, 100) + ": " + String(err));
    return _json({ e: "fetch failed: " + String(err) });
  }
}

// ── Batch Request ──────────────────────────────────────────

function _doBatch(items) {
  var fetchArgs = [];
  var fetchIndex = [];
  var fetchMethods = [];
  var errorMap = {};

  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || typeof item !== "object") {
      errorMap[i] = "bad item";
      continue;
    }
    if (!item.u || typeof item.u !== "string" || !item.u.match(/^https?:\/\//i)) {
      errorMap[i] = "bad url";
      continue;
    }
    try {
      var opts = _buildOpts(item);
      opts.url = item.u;
      fetchArgs.push(opts);
      fetchIndex.push(i);
      fetchMethods.push(String(item.m || "GET").toUpperCase());
    } catch (buildErr) {
      errorMap[i] = String(buildErr);
    }
  }

  var responses = [];
  if (fetchArgs.length > 0) {
    var batchStart = Date.now();
    try {
      responses = UrlFetchApp.fetchAll(fetchArgs);
      console.log("Batch fetchAll completed: " + fetchArgs.length + " requests, " + 
                  (Date.now() - batchStart) + " ms");
    } catch (fetchAllErr) {
      console.error("Batch fetchAll failed: " + fetchAllErr);
      responses = [];
      for (var j = 0; j < fetchArgs.length; j++) {
        try {
          if (!SAFE_REPLAY_METHODS[fetchMethods[j]]) {
            errorMap[fetchIndex[j]] = "batch fetchAll failed; unsafe method not replayed";
            responses[j] = null;
            continue;
          }
          var fallbackReq = fetchArgs[j];
          var fallbackUrl = fallbackReq.url;
          var fallbackOpts = {};
          for (var key in fallbackReq) {
            if (Object.prototype.hasOwnProperty.call(fallbackReq, key) && key !== "url") {
              fallbackOpts[key] = fallbackReq[key];
            }
          }
          responses[j] = UrlFetchApp.fetch(fallbackUrl, fallbackOpts);
        } catch (singleErr) {
          errorMap[fetchIndex[j]] = String(singleErr);
          responses[j] = null;
        }
      }
    }
  }

  var results = [];
  var rIdx = 0;
  for (var i = 0; i < items.length; i++) {
    if (Object.prototype.hasOwnProperty.call(errorMap, i)) {
      results.push({ e: errorMap[i] });
    } else {
      var resp = responses[rIdx++];
      if (!resp) {
        results.push({ e: "fetch failed" });
      } else {
        results.push({
          s: resp.getResponseCode(),
          h: _respHeaders(resp),
          b: Utilities.base64Encode(resp.getContent()),
        });
      }
    }
  }
  
  return _json({ q: results });
}

// ── Request Building ───────────────────────────────────────

function _buildOpts(req) {
  var opts = {
    method: (req.m || "GET").toLowerCase(),
    muteHttpExceptions: true,
    followRedirects: req.r !== false,
    validateHttpsCertificates: true,
    escaping: false,
  };
  if (req.h && typeof req.h === "object") {
    var headers = {};
    for (var k in req.h) {
      if (req.h.hasOwnProperty(k) && !SKIP_HEADERS[k.toLowerCase()]) {
        headers[k] = req.h[k];
      }
    }
    opts.headers = headers;
  }
  if (req.b) {
    opts.payload = Utilities.base64Decode(req.b);
    if (req.ct) opts.contentType = req.ct;
  }
  return opts;
}

function _respHeaders(resp) {
  try {
    if (typeof resp.getAllHeaders === "function") {
      return resp.getAllHeaders();
    }
  } catch (err) {}
  return resp.getHeaders();
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

// ═══════════════════════════════════════════════════════════
//  SPREADSHEET CACHE — IMPROVED WITH ERROR LOGGING
// ═══════════════════════════════════════════════════════════

function _initCacheSheet() {
  if (CACHE_SPREADSHEET_ID === "CHANGE_ME_TO_CACHE_SPREADSHEET_ID") {
    return null;
  }
  try {
    var ss = SpreadsheetApp.openById(CACHE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CACHE_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(CACHE_SHEET_NAME);
      sheet.getRange(1, 1, 1, 8).setValues([[
        "URL_Hash", "URL", "Status", "Headers", "Body", "Timestamp", "Expires_At", "Z"
      ]]);
    }
    return sheet;
  } catch (e) {
    console.error("Cache init failed: " + e);
    return null;
  }
}

function _getMetaSheet() {
  if (CACHE_SPREADSHEET_ID === "CHANGE_ME_TO_CACHE_SPREADSHEET_ID") {
    return null;
  }
  try {
    var ss = SpreadsheetApp.openById(CACHE_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(CACHE_META_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(CACHE_META_SHEET_NAME);
      sheet.getRange(CACHE_META_CURSOR_CELL).setValue(2);
      sheet.hideSheet();
    }
    return sheet;
  } catch (e) {
    console.error("Meta sheet init failed: " + e);
    return null;
  }
}

function _getCacheKey(url, reqHeaders) {
  var parts = [url];
  if (reqHeaders && typeof reqHeaders === "object") {
    for (var i = 0; i < VARY_KEY_HEADERS.length; i++) {
      var headerName = VARY_KEY_HEADERS[i];
      var rawValue = _getHeaderCaseInsensitive(reqHeaders, headerName);
      if (rawValue && String(rawValue).trim() !== "") {
        parts.push(headerName + ":" + rawValue.toLowerCase().replace(/\s/g, ""));
      } else {
        parts.push(headerName + ":<none>");
      }
    }
  } else {
    for (var j = 0; j < VARY_KEY_HEADERS.length; j++) {
      parts.push(VARY_KEY_HEADERS[j] + ":<none>");
    }
  }
  return _md5Hex(parts.join("|"));
}

function _md5Hex(input) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, input);
  return rawHash.map(function(byte) {
    var v = (byte < 0) ? 256 + byte : byte;
    return ("0" + v.toString(16)).slice(-2);
  }).join("");
}

function _getHeaderCaseInsensitive(headers, targetKey) {
  var target = targetKey.toLowerCase();
  for (var k in headers) {
    if (headers.hasOwnProperty(k) && k.toLowerCase() === target) {
      return headers[k];
    }
  }
  return null;
}

function _canUseCache(req) {
  if ((req.m || "GET") !== "GET") return false;
  if (req.b) return false;
  if (!req.u || !req.u.match(/^https?:\/\//i)) return false;
  if (CACHE_SPREADSHEET_ID === "CHANGE_ME_TO_CACHE_SPREADSHEET_ID") return false;
  if (req.h && typeof req.h === "object") {
    for (var k in req.h) {
      if (req.h.hasOwnProperty(k) && CACHE_BUSTING_HEADERS[k.toLowerCase()]) {
        return false;
      }
    }
  }
  return true;
}

function _parseMaxAge(cacheControlHeader) {
  if (!cacheControlHeader) return CACHE_DEFAULT_TTL_SECONDS;
  var lower = cacheControlHeader.toLowerCase();
  if (lower.indexOf("no-cache") !== -1 || lower.indexOf("no-store") !== -1 || lower.indexOf("private") !== -1) {
    return 0;
  }
  var match = lower.match(/max-age=(\d+)/);
  if (match) {
    var ttl = parseInt(match[1], 10);
    return Math.max(60, Math.min(ttl, 2592000));
  }
  return CACHE_DEFAULT_TTL_SECONDS;
}

function _refreshCachedHeaders(headersJson, timestamp) {
  var headers = JSON.parse(headersJson);
  var cachedAt = new Date(timestamp);
  var now = new Date();
  var ageSeconds = Math.floor((now.getTime() - cachedAt.getTime()) / 1000);
  if (ageSeconds < 0) ageSeconds = 0;
  headers["Date"] = now.toUTCString();
  headers["Age"] = String(ageSeconds);
  var originalCc = headers["Cache-Control"] || headers["cache-control"];
  if (originalCc) {
    headers["X-Original-Cache-Control"] = originalCc;
  }
  var remainingMaxAge = Math.max(0, _parseMaxAge(originalCc) - ageSeconds);
  headers["Cache-Control"] = "public, max-age=" + remainingMaxAge;
  headers["X-Cache"] = "HIT from relay-spreadsheet";
  headers["X-Cached-At"] = cachedAt.toUTCString();
  return JSON.stringify(headers);
}

function _getFromCache(url, reqHeaders) {
  var sheet = _initCacheSheet();
  if (!sheet) return null;
  var hash = _getCacheKey(url, reqHeaders);
  var finder = sheet.createTextFinder(hash).matchEntireCell(true);
  var found = finder.findNext();
  if (found) {
    var row = sheet.getRange(found.getRow(), 1, 1, 8).getValues()[0];
    var expiresAt = row[6];
    if (expiresAt && expiresAt instanceof Date && expiresAt < new Date()) {
      return null;
    }
    var storedBody = row[4];
    var body;
    if (row[7]) {
      var gzipped = Utilities.base64Decode(storedBody);
      var raw = Utilities.ungzip(Utilities.newBlob(gzipped, "application/x-gzip")).getBytes();
      body = Utilities.base64Encode(raw);
    } else {
      body = storedBody;
    }
    return {
      status: row[2],
      headers: _refreshCachedHeaders(row[3], row[5]),
      body: body,
    };
  }
  return null;
}

function _fetchAndCache(url, reqHeaders) {
  var sheet = _initCacheSheet();
  if (!sheet) return null;
  
  var fetchStart = Date.now();
  
  try {
    // Improved: pass headers to fetch request
    var fetchOpts = {
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true
    };
    
    if (reqHeaders && typeof reqHeaders === "object") {
      var filteredHeaders = {};
      for (var k in reqHeaders) {
        if (reqHeaders.hasOwnProperty(k) && !SKIP_HEADERS[k.toLowerCase()]) {
          filteredHeaders[k] = reqHeaders[k];
        }
      }
      if (Object.keys(filteredHeaders).length > 0) {
        fetchOpts.headers = filteredHeaders;
      }
    }
    
    var response = UrlFetchApp.fetch(url, fetchOpts);
    var fetchDuration = Date.now() - fetchStart;
    
    var status = response.getResponseCode();
    var headers = _respHeaders(response);
    var bodyBytes = response.getContent();
    var rawB64 = Utilities.base64Encode(bodyBytes);
    var headersJson = JSON.stringify(headers);
    var liveResult = { status: status, headers: headersJson, body: rawB64 };
    
    console.log("Cache fetch: " + fetchDuration + " ms, status: " + status + 
                ", size: " + bodyBytes.length + " bytes for " + url.substring(0, 80));
    
    if (status >= 500) return liveResult;
    
    var cacheControl = headers["Cache-Control"] || headers["cache-control"] || null;
    var ttlSeconds = _parseMaxAge(cacheControl);
    if (ttlSeconds === 0) return liveResult;
    
    if (NEGATIVE_CACHE_STATUSES[status] && !cacheControl) {
      ttlSeconds = NEGATIVE_CACHE_TTL_SECONDS;
    }
    
    var contentEncoding = String(headers["Content-Encoding"] || headers["content-encoding"] || "").toLowerCase();
    var alreadyEncoded = contentEncoding && contentEncoding !== "identity";
    var storedBody;
    var storedZ;
    
    if (alreadyEncoded || bodyBytes.length < GZIP_MIN_BYTES) {
      storedBody = rawB64;
      storedZ = 0;
    } else {
      storedBody = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(bodyBytes)).getBytes());
      storedZ = 1;
    }
    
    if (storedBody.length > CACHE_MAX_BODY_BYTES) return liveResult;
    
    var hash = _getCacheKey(url, reqHeaders);
    var timestamp = new Date();
    var expiresAt = new Date(timestamp.getTime() + ttlSeconds * 1000);
    if (isNaN(expiresAt.getTime())) {
      expiresAt = new Date(timestamp.getTime() + CACHE_DEFAULT_TTL_SECONDS * 1000);
    }
    
    var rowData = [hash, url, status, headersJson, storedBody, timestamp.toISOString(), expiresAt, storedZ];
    
    var metaSheet = _getMetaSheet();
    if (metaSheet) {
      _ensureRowsAllocated(sheet);
      var writeRow = _getNextCursor(sheet, metaSheet);
      sheet.getRange(writeRow, 1, 1, 8).setValues([rowData]);
      _advanceCursor(metaSheet, writeRow);
    } else {
      sheet.appendRow(rowData);
    }
    
    return liveResult;
  } catch (e) {
    console.error("Cache fetch error for " + url.substring(0, 80) + ": " + e);
    return null;
  }
}

function _getNextCursor(sheet, metaSheet) {
  var cursorRange = metaSheet.getRange(CACHE_META_CURSOR_CELL);
  var cursor = cursorRange.getValue();
  if (typeof cursor !== "number" || cursor < 2) cursor = 2;
  var totalRows = sheet.getDataRange().getNumRows();
  if (totalRows < CACHE_MAX_ROWS + 1) {
    return totalRows + 1;
  }
  return cursor;
}

function _advanceCursor(metaSheet, currentRow) {
  var nextRow = currentRow + 1;
  if (nextRow > CACHE_MAX_ROWS + 1) nextRow = 2;
  metaSheet.getRange(CACHE_META_CURSOR_CELL).setValue(nextRow);
}

function _ensureRowsAllocated(sheet) {
  var totalRows = sheet.getDataRange().getNumRows();
  if (totalRows < CACHE_MAX_ROWS + 1) {
    var needed = CACHE_MAX_ROWS + 1 - totalRows;
    sheet.insertRowsAfter(totalRows, needed);
  }
}

// ═══════════════════════════════════════════════════════════
//  DIAGNOSTICS
// ═══════════════════════════════════════════════════════════

function getCacheStats() {
  var sheet = _initCacheSheet();
  if (!sheet) {
    console.log("Cache is not enabled or spreadsheet unavailable.");
    return;
  }
  var data = sheet.getDataRange().getValues();
  var totalEntries = data.length - 1;
  var now = new Date();
  var expiredCount = 0;
  for (var i = 1; i < data.length; i++) {
    var expiresAt = data[i][6];
    if (expiresAt && expiresAt instanceof Date && expiresAt < now) {
      expiredCount++;
    }
  }
  console.log("=== CACHE STATS ===");
  console.log("Total rows used: " + totalEntries + " / " + CACHE_MAX_ROWS);
  console.log("Active entries: " + (totalEntries - expiredCount));
  console.log("Expired entries: " + expiredCount);
}

function clearExpiredCache() {
  var sheet = _initCacheSheet();
  if (!sheet) {
    console.log("Cache is not enabled.");
    return;
  }
  var data = sheet.getDataRange().getValues();
  var now = new Date();
  var rowsToClear = [];
  for (var i = 1; i < data.length; i++) {
    var expiresAt = data[i][6];
    if (expiresAt && expiresAt instanceof Date && expiresAt < now) {
      rowsToClear.push(i + 1);
    }
  }
  for (var j = 0; j < rowsToClear.length; j++) {
    sheet.getRange(rowsToClear[j], 1, 1, 8).clearContent();
  }
  console.log("Cleared " + rowsToClear.length + " expired entries.");
}

function clearEntireCache() {
  var sheet = _initCacheSheet();
  if (sheet) {
    var totalRows = sheet.getDataRange().getNumRows();
    if (totalRows > 1) {
      sheet.getRange(2, 1, totalRows - 1, 8).clearContent();
    }
  }
  var metaSheet = _getMetaSheet();
  if (metaSheet) {
    metaSheet.getRange(CACHE_META_CURSOR_CELL).setValue(2);
  }
  console.log("Cache wiped. Cursor reset to row 2.");
}
