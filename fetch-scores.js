// fetch-scores.js
// Runs in GitHub Actions every 5 minutes. Fetches worldcup26.ir games,
// maps English team names -> the tracker's 3-letter codes, and writes
// results.json in the shape index.html expects:
//   { updated, matches:[ {group,home,away,hs,as,status} ] }

const https = require("https");

const SRC = "https://worldcup26.ir/get/games";

// English name (as the feed spells it) -> tracker 3-letter code.
// Includes a few likely alternate spellings the feed might use.
const NAME2CODE = {
  "Mexico":"MEX","South Korea":"KOR","Korea Republic":"KOR","South Africa":"RSA","Czechia":"CZE","Czech Republic":"CZE",
  "Canada":"CAN","Bosnia & Herzegovina":"BIH","Bosnia and Herzegovina":"BIH","Bosnia":"BIH","Qatar":"QAT","Switzerland":"SUI",
  "Scotland":"SCO","Brazil":"BRA","Morocco":"MAR","Haiti":"HAI",
  "United States":"USA","USA":"USA","Australia":"AUS","Turkey":"TUR","Turkiye":"TUR","Türkiye":"TUR","Paraguay":"PAR",
  "Germany":"GER","Ivory Coast":"CIV","Cote d'Ivoire":"CIV","Côte d'Ivoire":"CIV","Ecuador":"ECU","Curacao":"CUR","Curaçao":"CUR",
  "Sweden":"SWE","Netherlands":"NED","Japan":"JPN","Tunisia":"TUN",
  "Belgium":"BEL","Iran":"IRN","IR Iran":"IRN","Egypt":"EGY","New Zealand":"NZL",
  "Spain":"ESP","Uruguay":"URU","Saudi Arabia":"KSA","Cape Verde":"CPV","Cabo Verde":"CPV",
  "France":"FRA","Senegal":"SEN","Norway":"NOR","Iraq":"IRQ",
  "Argentina":"ARG","Austria":"AUT","Algeria":"ALG","Jordan":"JOR",
  "Portugal":"POR","Colombia":"COL","Uzbekistan":"UZB","DR Congo":"COD","DR Congo (Congo DR)":"COD","Congo DR":"COD","Democratic Republic of the Congo":"COD",
  "England":"ENG","Croatia":"CRO","Panama":"PAN","Ghana":"GHA"
};

function get(url, redirects){
  redirects = redirects || 0;
  return new Promise((resolve,reject)=>{
    const opts = {
      headers: {
        // Look like a real browser — a bot user-agent is the likely cause of blocks
        "User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept":"application/json, text/plain, */*",
        "Accept-Language":"en-GB,en;q=0.9"
      }
    };
    const req = https.get(url, opts, res=>{
      // follow redirects (301/302/307/308)
      if([301,302,307,308].includes(res.statusCode) && res.headers.location && redirects<5){
        res.resume();
        return resolve(get(res.headers.location, redirects+1));
      }
      if(res.statusCode !== 200){
        let body=""; res.on("data",c=>body+=c);
        res.on("end",()=>reject(new Error("HTTP "+res.statusCode+" from feed. First 200 chars: "+body.slice(0,200))));
        return;
      }
      let d=""; res.on("data",c=>d+=c); res.on("end",()=>resolve(d));
    });
    req.on("error",reject);
    req.setTimeout(20000, ()=>{ req.destroy(new Error("Request timed out after 20s")); });
  });
}

function code(name){
  if(!name) return null;
  if(NAME2CODE[name]) return NAME2CODE[name];
  // tolerant fallback: trim and case-insensitive match
  const k=Object.keys(NAME2CODE).find(n=>n.toLowerCase()===String(name).trim().toLowerCase());
  return k?NAME2CODE[k]:null;
}

(async ()=>{
  let raw;
  try{
    raw = await get(SRC);
  }catch(e){
    console.error("FETCH FAILED:", e.message);
    console.error("The data source may be blocking automated requests, or be temporarily down.");
    process.exit(1);
  }

  let data;
  try{ data = JSON.parse(raw); }
  catch(e){
    console.error("Could not parse feed as JSON. First 300 chars of what came back:");
    console.error(String(raw).slice(0,300));
    process.exit(1);
  }

  // feed may return an array, or {games:[...]} / {data:[...]} — handle all
  const games = Array.isArray(data) ? data
              : (data.games || data.data || data.matches || []);

  const matches = [];
  let skipped = [];
  for(const g of games){
    if((g.type||"").toLowerCase() !== "group") continue;  // group stage only
    const home = code(g.home_team_name_en);
    const away = code(g.away_team_name_en);
    if(!home || !away){ skipped.push(g.home_team_name_en+" v "+g.away_team_name_en); continue; }

    const fin = String(g.finished).toUpperCase()==="TRUE";
    const elapsed = String(g.time_elapsed||"").toLowerCase();
    const live = !fin && elapsed!=="notstarted" && elapsed!=="" ;
    const hs = (g.home_score===""||g.home_score==null) ? null : parseInt(g.home_score,10);
    const as = (g.away_score===""||g.away_score==null) ? null : parseInt(g.away_score,10);

    matches.push({
      group: String(g.group||"").replace(/group/i,"").trim(),
      home, away,
      hs: fin ? hs : (live ? hs : null),
      as: fin ? as : (live ? as : null),
      status: fin ? "finished" : (live ? "live" : "scheduled")
    });
  }

  const out = { updated: new Date().toISOString(), matches };
  require("fs").writeFileSync("results.json", JSON.stringify(out,null,2));
  console.log(`Wrote ${matches.length} group matches.`);
  if(skipped.length) console.log("Unmapped (ignored):", [...new Set(skipped)].join(", "));
})();
