// one address only: https://treid.fun (wallet deep links keep their keys per address — http:// or www. would lose them)
(function () { var h = location.hostname; if ((h === "treid.fun" || h === "www.treid.fun") && (location.protocol !== "https:" || h !== "treid.fun")) location.replace("https://treid.fun" + location.pathname + location.search + location.hash); })();
