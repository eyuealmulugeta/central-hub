// Every country in the world (v0.24.0), for a project's country. Two-letter ISO codes with their three-letter ones;
// the names come from the browser's own list (Intl.DisplayNames), so they need no upkeep. The country never changes
// a project's currency (USD, see engine/currencies.js).

const ISO = `AF:AFG AL:ALB DZ:DZA AD:AND AO:AGO AG:ATG AR:ARG AM:ARM AU:AUS AT:AUT AZ:AZE BS:BHS BH:BHR BD:BGD BB:BRB BY:BLR BE:BEL BZ:BLZ
BJ:BEN BT:BTN BO:BOL BA:BIH BW:BWA BR:BRA BN:BRN BG:BGR BF:BFA BI:BDI CV:CPV KH:KHM CM:CMR CA:CAN CF:CAF TD:TCD CL:CHL CN:CHN
CO:COL KM:COM CG:COG CD:COD CR:CRI CI:CIV HR:HRV CU:CUB CY:CYP CZ:CZE DK:DNK DJ:DJI DM:DMA DO:DOM EC:ECU EG:EGY SV:SLV GQ:GNQ
ER:ERI EE:EST SZ:SWZ ET:ETH FJ:FJI FI:FIN FR:FRA GA:GAB GM:GMB GE:GEO DE:DEU GH:GHA GR:GRC GD:GRD GT:GTM GN:GIN GW:GNB GY:GUY
HT:HTI HN:HND HU:HUN IS:ISL IN:IND ID:IDN IR:IRN IQ:IRQ IE:IRL IL:ISR IT:ITA JM:JAM JP:JPN JO:JOR KZ:KAZ KE:KEN KI:KIR KP:PRK
KR:KOR XK:XKX KW:KWT KG:KGZ LA:LAO LV:LVA LB:LBN LS:LSO LR:LBR LY:LBY LI:LIE LT:LTU LU:LUX MG:MDG MW:MWI MY:MYS MV:MDV ML:MLI
MT:MLT MH:MHL MR:MRT MU:MUS MX:MEX FM:FSM MD:MDA MC:MCO MN:MNG ME:MNE MA:MAR MZ:MOZ MM:MMR NA:NAM NR:NRU NP:NPL NL:NLD NZ:NZL
NI:NIC NE:NER NG:NGA MK:MKD NO:NOR OM:OMN PK:PAK PW:PLW PS:PSE PA:PAN PG:PNG PY:PRY PE:PER PH:PHL PL:POL PT:PRT QA:QAT RO:ROU
RU:RUS RW:RWA KN:KNA LC:LCA VC:VCT WS:WSM SM:SMR ST:STP SA:SAU SN:SEN RS:SRB SC:SYC SL:SLE SG:SGP SK:SVK SI:SVN SB:SLB SO:SOM
ZA:ZAF SS:SSD ES:ESP LK:LKA SD:SDN SR:SUR SE:SWE CH:CHE SY:SYR TW:TWN TJ:TJK TZ:TZA TH:THA TL:TLS TG:TGO TO:TON TT:TTO TN:TUN
TR:TUR TM:TKM TV:TUV UG:UGA UA:UKR AE:ARE GB:GBR US:USA UY:URY UZ:UZB VU:VUT VA:VAT VE:VEN VN:VNM YE:YEM ZM:ZMB ZW:ZWE
HK:HKG MO:MAC PR:PRI GL:GRL RE:REU YT:MYT EH:ESH`;

/** [two-letter, three-letter] for every country. */
export const COUNTRY_CODES = ISO.split(/\s+/).filter(Boolean).map(x => x.split(':'));

let names = null;
const nameOf = code => {
  try { names ||= new Intl.DisplayNames(['en'], { type: 'region' }); return names.of(code) || code; } catch { return code; }
};

/** [code, name] for every country, by name. */
export const countryList = () => COUNTRY_CODES.map(([c]) => [c, nameOf(c)]).sort((a, b) => a[1].localeCompare(b[1]));
/** The name of a two-letter code ('' for none). */
export const countryName = code => (code ? nameOf(String(code).toUpperCase()) : '');
/** The ISO three-letter code of a two-letter one ('' when unknown). */
export const iso3 = code => COUNTRY_CODES.find(([c]) => c === String(code || '').toUpperCase())?.[1] || '';
