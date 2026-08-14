(function () {
  const API_BASE = "https://data.oceannetworks.ca/api";
  const TOKEN_PLACEHOLDER = "YOUR_TOKEN";

  const ARCHIVE_LABELS = {
    flac: "lossless audio",
    wav: "uncompressed audio",
    mp3: "compressed audio",
    fft: "proprietary spectral",
    mat: "MATLAB / spectral",
    png: "plot / spectrogram",
    pdf: "PDF plot",
    txt: "logs / calibration",
    acc: "acceleration",
    hyd: "array raw (retired)",
    oct: "octave spectral",
    csv: "scalar table",
    json: "JSON",
    an: "annotation",
    qaqc: "QAQC results",
    vtt: "captions"
  };

  function archiveExtensions(catalog) {
    const found = [];
    (catalog.products || []).forEach(function (p) {
      (p.formats || []).forEach(function (f) {
        if (f.extension && found.indexOf(f.extension) === -1) found.push(f.extension);
      });
    });
    ["flac", "wav", "mp3", "fft", "mat", "png", "txt"].forEach(function (ext) {
      if (found.indexOf(ext) === -1) found.push(ext);
    });
    const preferred = ["flac", "wav", "mp3", "fft", "mat", "png", "txt"];
    found.sort(function (a, b) {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return found;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function catalogEl() {
    return document.getElementById("onc-hydro-catalog");
  }

  function loadCatalog() {
    const el = catalogEl();
    if (!el) return { locations: [], devices: [], deployments: [], products: [] };
    try {
      return JSON.parse(el.textContent);
    } catch (err) {
      console.warn("Could not parse hydrophone catalog", err);
      return { locations: [], devices: [], deployments: [], products: [] };
    }
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalInput(date) {
    return (
      date.getFullYear() +
      "-" + pad(date.getMonth() + 1) +
      "-" + pad(date.getDate()) +
      "T" + pad(date.getHours()) +
      ":" + pad(date.getMinutes())
    );
  }

  function toOncIso(localValue) {
    if (!localValue) return "";
    const date = new Date(localValue);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uniqueBy(items, keyFn) {
    const seen = new Map();
    items.forEach(function (item) {
      const key = keyFn(item);
      if (!seen.has(key)) seen.set(key, item);
    });
    return Array.from(seen.values());
  }

  function fillDatalist(listId, items) {
    const list = $(listId);
    if (!list) return;
    list.innerHTML = items.map(function (item) {
      return '<option value="' + escapeHtml(item.value) + '">' +
        escapeHtml(item.label) + "</option>";
    }).join("");
  }

  function productByCode(catalog, code) {
    return (catalog.products || []).find(function (p) { return p.code === code; });
  }

  function formatForProduct(product, extension) {
    if (!product) return null;
    return (product.formats || []).find(function (f) { return f.extension === extension; }) ||
      (product.formats || [])[0] ||
      null;
  }

  function currentState(catalog) {
    const lookup = (document.querySelector('input[name="api-lookup"]:checked') || {}).value || "location";
    const method = (document.querySelector('input[name="api-method"]:checked') || {}).value || "archive";
    const archiveAction = (document.querySelector('input[name="api-archive-action"]:checked') || {}).value || "download";
    const locationCode = ($("api-location") || {}).value.trim();
    const deviceCode = ($("api-device") || {}).value.trim();
    const dateFrom = toOncIso(($("api-date-from") || {}).value);
    const dateTo = toOncIso(($("api-date-to") || {}).value);
    const token = (($("api-token") || {}).value || "").trim() || TOKEN_PLACEHOLDER;
    const productCode = ($("api-product") || {}).value;
    const orderExt = ($("api-order-ext") || {}).value;
    const archiveExt = ($("api-archive-ext") || {}).value;
    const includeMeta = ($("api-include-meta") || {}).checked;

    const product = productByCode(catalog, productCode);
    const format = formatForProduct(product, orderExt);
    const dpos = {};
    if (method === "order" && format) {
      (format.options || []).forEach(function (opt) {
        const input = document.querySelector('[data-dpo="' + opt.option + '"]');
        if (!input) return;
        const value = input.value;
        if (value !== "" && value != null) dpos[opt.option] = value;
      });
    }

    return {
      lookup: lookup,
      method: method,
      archiveAction: archiveAction,
      locationCode: locationCode,
      deviceCode: deviceCode,
      dateFrom: dateFrom,
      dateTo: dateTo,
      token: token,
      productCode: productCode,
      productName: product ? product.name : "",
      extension: method === "archive" ? archiveExt : orderExt,
      includeMeta: includeMeta,
      dpos: dpos
    };
  }

  function filters(state) {
    const params = {};
    if (state.lookup === "device") {
      params.deviceCode = state.deviceCode || "ICLISTENHF6016";
    } else {
      params.locationCode = state.locationCode || "CQSH.H1";
      params.deviceCategoryCode = "HYDROPHONE";
    }
    if (state.dateFrom) params.dateFrom = state.dateFrom;
    if (state.dateTo) params.dateTo = state.dateTo;
    if (state.extension) params.extension = state.extension;
    if (state.method === "order") {
      params.dataProductCode = state.productCode || "AD";
      Object.keys(state.dpos).forEach(function (key) {
        params[key] = state.dpos[key];
      });
    }
    return params;
  }

  function pyString(value) {
    return JSON.stringify(String(value));
  }

  function pyParams(params) {
    const keys = Object.keys(params);
    const lines = keys.map(function (key, i) {
      const comma = i < keys.length - 1 ? "," : "";
      return "    " + pyString(key) + ": " + pyString(params[key]) + comma;
    });
    return "{\n" + lines.join("\n") + "\n}";
  }

  function matlabParams(params) {
    const keys = Object.keys(params);
    const lines = keys.map(function (key, i) {
      const comma = i < keys.length - 1 ? ", ..." : "";
      return "    '" + key + "', '" + String(params[key]).replace(/'/g, "''") + "'" + comma;
    });
    return "struct( ...\n" + lines.join("\n") + ")";
  }

  function queryString(params, token) {
    const all = Object.assign({ token: token }, params);
    return Object.keys(all).map(function (key) {
      return encodeURIComponent(key) + "=" + encodeURIComponent(all[key]);
    }).join("&");
  }

  function restPath(state) {
    if (state.method === "order") return "/dataProductDelivery/request";
    return state.lookup === "device" ? "/archivefile/device" : "/archivefile/location";
  }

  function pythonCode(state, params) {
    const lines = [
      "from onc import ONC",
      "",
      "onc = ONC(" + pyString(state.token) + ")",
      "params = " + pyParams(params)
    ];
    if (state.method === "archive") {
      if (state.archiveAction === "list") {
        lines.push("result = onc.getArchivefile(params, allPages=True)");
      } else {
        lines.push("result = onc.downloadDirectArchivefile(params)");
      }
    } else {
      lines.push(
        "result = onc.orderDataProduct(params, includeMetadataFile=" +
        (state.includeMeta ? "True" : "False") + ")"
      );
    }
    return lines.join("\n");
  }

  function matlabCode(state, params) {
    const token = state.token.replace(/'/g, "''");
    const lines = [
      "onc = Onc('" + token + "');",
      "params = " + matlabParams(params) + ";"
    ];
    if (state.method === "archive") {
      if (state.lookup === "device") {
        lines.push(state.archiveAction === "list"
          ? "result = onc.getListByDevice(params);"
          : "result = onc.getDirectFiles(params);");
      } else {
        lines.push(state.archiveAction === "list"
          ? "result = onc.getListByLocation(params);"
          : "result = onc.getDirectFiles(params);");
      }
    } else {
      lines.push("result = onc.orderDataProduct(params);");
    }
    return lines.join("\n");
  }

  function curlCode(state, params) {
    const url = API_BASE + restPath(state) + "?" + queryString(params, state.token);
    const lines = [
      "curl -L \\" ,
      "  \"" + url + "\""
    ];
    if (state.method === "order") {
      lines.push("");
      lines.push("# orderDataProduct wraps request → run → download.");
      lines.push("# After this request returns dpRequestId, run:");
      lines.push("#   GET " + API_BASE + "/dataProductDelivery/run?dpRequestId=<id>&token=" + state.token);
      lines.push("# then download with /dataProductDelivery/download");
    } else if (state.archiveAction === "download") {
      lines.push("");
      lines.push("# This lists matching archive files. To download one file:");
      lines.push("# curl -L -o FILE.flac \"" + API_BASE + "/archivefile/download?filename=FILE.flac&token=" + state.token + "\"");
    }
    return lines.join("\n");
  }

  function renderDpoFields(format) {
    const box = $("api-dpo-fields");
    if (!box) return;
    const options = (format && format.options) || [];
    if (!options.length) {
      box.innerHTML = "<p class='api-hint'>No extra data-product options for this format.</p>";
      return;
    }
    box.innerHTML = options.map(function (opt) {
      const id = "dpo-" + opt.option;
      const values = opt.allowableValues || [];
      const range = opt.allowableRange;
      const def = opt.defaultValue == null ? "" : String(opt.defaultValue);
      let control;
      if (values.length) {
        control = "<select id='" + id + "' data-dpo='" + escapeHtml(opt.option) + "'>" +
          values.map(function (v) {
            const selected = String(v) === def ? " selected" : "";
            return "<option value='" + escapeHtml(v) + "'" + selected + ">" + escapeHtml(v) + "</option>";
          }).join("") +
          "</select>";
      } else if (range) {
        const min = range.lowerBound != null ? " min='" + escapeHtml(range.lowerBound) + "'" : "";
        const max = range.upperBound != null ? " max='" + escapeHtml(range.upperBound) + "'" : "";
        control = "<input type='number' id='" + id + "' data-dpo='" + escapeHtml(opt.option) + "'" +
          min + max + " value='" + escapeHtml(def) + "'>";
      } else {
        control = "<input type='text' id='" + id + "' data-dpo='" + escapeHtml(opt.option) + "' value='" + escapeHtml(def) + "'>";
      }
      return "<label class='api-field'><span>" + escapeHtml(opt.option) + "</span>" + control + "</label>";
    }).join("");
  }

  function syncProductFormats(catalog) {
    const product = productByCode(catalog, ($("api-product") || {}).value);
    const extSel = $("api-order-ext");
    if (!extSel) return;
    const formats = (product && product.formats) || [{ extension: "flac" }];
    const current = extSel.value;
    extSel.innerHTML = formats.map(function (f) {
      return "<option value='" + escapeHtml(f.extension) + "'>" + escapeHtml(f.extension) + "</option>";
    }).join("");
    const keep = formats.some(function (f) { return f.extension === current; });
    if (keep) extSel.value = current;
    renderDpoFields(formatForProduct(product, extSel.value));
  }

  function syncPanels() {
    const method = (document.querySelector('input[name="api-method"]:checked') || {}).value || "archive";
    const lookup = (document.querySelector('input[name="api-lookup"]:checked') || {}).value || "location";
    document.querySelectorAll("[data-panel]").forEach(function (el) {
      const show = el.getAttribute("data-panel") === method;
      el.hidden = !show;
    });
    const locWrap = $("api-location-wrap");
    const devWrap = $("api-device-wrap");
    if (locWrap) locWrap.classList.toggle("api-required", lookup === "location");
    if (devWrap) devWrap.classList.toggle("api-required", lookup === "device");
  }

  function updateCode(catalog) {
    const state = currentState(catalog);
    const params = filters(state);
    const endpoint = API_BASE + restPath(state);
    const urlEl = $("api-rest-url");
    if (urlEl) urlEl.textContent = endpoint + "?" + queryString(params, state.token);

    $("api-code-python").textContent = pythonCode(state, params);
    $("api-code-matlab").textContent = matlabCode(state, params);
    $("api-code-curl").textContent = curlCode(state, params);
  }

  function setTab(lang) {
    document.querySelectorAll(".api-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-lang") === lang);
    });
    document.querySelectorAll(".api-code").forEach(function (pre) {
      pre.hidden = pre.id !== "api-code-" + lang;
    });
  }

  function copyActive() {
    const active = document.querySelector(".api-code:not([hidden])");
    if (!active) return;
    const text = active.textContent;
    const done = function () {
      const btn = $("api-copy");
      if (!btn) return;
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text); done();
      });
    } else {
      fallbackCopy(text); done();
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (err) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function initDefaults() {
    const to = new Date();
    const from = new Date(to.getTime() - 5 * 60 * 1000);
    const fromEl = $("api-date-from");
    const toEl = $("api-date-to");
    if (fromEl && !fromEl.value) fromEl.value = toLocalInput(from);
    if (toEl && !toEl.value) toEl.value = toLocalInput(to);
  }

  function init() {
    const catalog = loadCatalog();
    const locations = uniqueBy(catalog.locations || [], function (x) { return x.locationCode; })
      .sort(function (a, b) {
        return (a.locationName || a.locationCode).localeCompare(b.locationName || b.locationCode);
      });
    const devices = uniqueBy(catalog.devices || [], function (x) { return x.deviceCode; })
      .sort(function (a, b) { return a.deviceCode.localeCompare(b.deviceCode); });

    fillDatalist("api-location-list", locations.map(function (loc) {
      const name = (loc.locationName || loc.locationCode).trim();
      return {
        value: loc.locationCode,
        label: name === loc.locationCode ? loc.locationCode : name + " — " + loc.locationCode
      };
    }));
    fillDatalist("api-device-list", devices.map(function (dev) {
      return { value: dev.deviceCode, label: dev.deviceCode };
    }));

    const productSel = $("api-product");
    if (productSel) {
      productSel.innerHTML = (catalog.products || []).map(function (p) {
        return "<option value='" + escapeHtml(p.code) + "'>" +
          escapeHtml(p.code) + " — " + escapeHtml(p.name) + "</option>";
      }).join("");
    }

    const archSel = $("api-archive-ext");
    if (archSel) {
      archSel.innerHTML = archiveExtensions(catalog).map(function (ext) {
        const note = ARCHIVE_LABELS[ext] ? " — " + ARCHIVE_LABELS[ext] : "";
        return "<option value='" + escapeHtml(ext) + "'>" + escapeHtml(ext) + note + "</option>";
      }).join("");
      archSel.value = "flac";
    }

    initDefaults();
    syncProductFormats(catalog);
    syncPanels();
    setTab("python");
    updateCode(catalog);

    const form = $("api-builder");
    if (form) {
      form.addEventListener("input", function (evt) {
        const target = evt.target || {};
        if (target.id === "api-product" || target.id === "api-order-ext") {
          syncProductFormats(catalog);
        }
        if (target.name === "api-method" || target.name === "api-lookup") syncPanels();
        updateCode(catalog);
      });
      form.addEventListener("change", function (evt) {
        const target = evt.target || {};
        syncPanels();
        if (target.id === "api-product" || target.id === "api-order-ext") {
          syncProductFormats(catalog);
        }
        updateCode(catalog);
      });
    }

    document.querySelectorAll(".api-tab").forEach(function (btn) {
      btn.addEventListener("click", function () { setTab(btn.getAttribute("data-lang")); });
    });
    const copyBtn = $("api-copy");
    if (copyBtn) copyBtn.addEventListener("click", copyActive);

    const locInput = $("api-location");
    if (locInput) {
      locInput.addEventListener("change", function () {
        const code = locInput.value.trim();
        const match = (catalog.deployments || []).find(function (d) {
          return d.locationCode === code && d.active;
        }) || (catalog.deployments || []).find(function (d) {
          return d.locationCode === code;
        });
        if (match && $("api-device") && !$("api-device").value) {
          $("api-device").value = match.deviceCode;
          updateCode(catalog);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
