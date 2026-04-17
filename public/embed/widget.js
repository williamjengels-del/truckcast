(function () {
  var script = document.currentScript;
  if (!script) return;

  var truckId = script.getAttribute("data-truck-id");
  if (!truckId) {
    console.error("VendCast widget: missing data-truck-id attribute");
    return;
  }

  var baseUrl = script.src.replace(/\/embed\/widget\.js.*$/, "");
  var theme = script.getAttribute("data-theme") || "light";
  var limit = script.getAttribute("data-limit") || "20";
  var header = script.getAttribute("data-header") || "true";
  var accent = script.getAttribute("data-accent") || "";

  var src = baseUrl + "/embed/" + truckId + "?theme=" + theme + "&limit=" + limit + "&header=" + header;
  if (accent) src += "&accent=" + accent;

  var iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.style.width = "100%";
  iframe.style.height = "600px";
  iframe.style.border = "none";
  iframe.style.borderRadius = "8px";
  iframe.title = "Food Truck Schedule";
  iframe.setAttribute("loading", "lazy");

  script.parentNode.insertBefore(iframe, script.nextSibling);
})();
