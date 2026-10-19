// App icons. Each is a few bold, rounded shapes that overlap, in three brand
// tones: teal (.ia), gold (.ib) and a deep ink (.ic), with cream (.iw) for
// details on top of a shape. The tones are CSS variables, so they follow the
// light and dark themes. Drawn for a 24 x 24 box; original to Central Hub.

export const MARKS = {
  home: `
    <rect class="ia" x="5" y="10" width="14" height="11" rx="1.6"/>
    <path class="ib" d="M12 2.6 22 11.4H2z"/>
    <rect class="ic" x="10" y="14.2" width="4" height="6.8" rx="1"/>`,
  dashboard: `
    <rect class="ia" x="3" y="3" width="8.2" height="11" rx="2"/>
    <rect class="ib" x="12.8" y="3" width="8.2" height="6.2" rx="2"/>
    <rect class="ic" x="12.8" y="10.8" width="8.2" height="10.2" rx="2"/>
    <rect class="ib" x="3" y="15.6" width="8.2" height="5.4" rx="2" opacity=".55"/>`,
  reports: `
    <rect class="ia" x="4" y="4" width="16" height="18" rx="2.6"/>
    <rect class="ib" x="8" y="2" width="8" height="5" rx="1.6"/>
    <rect class="iw" x="7.5" y="10" width="9" height="1.9" rx=".95"/>
    <rect class="iw" x="7.5" y="13.7" width="9" height="1.9" rx=".95"/>
    <rect class="iw" x="7.5" y="17.4" width="5.2" height="1.9" rx=".95"/>`,
  schedule: `
    <rect class="ia" x="2.5" y="4" width="12" height="4.6" rx="2.3"/>
    <rect class="ib" x="7" y="9.7" width="14.5" height="4.6" rx="2.3"/>
    <rect class="ic" x="4.5" y="15.4" width="11" height="4.6" rx="2.3"/>`,
  estimator: `
    <path class="ia" d="M3 21.2V5.4a1 1 0 011.7-.7l15.8 15.8a.4.4 0 01-.3.7z"/>
    <path class="iw" d="M6.6 17.6v-4.2l4.2 4.2z"/>
    <rect class="ib" x="13.6" y="2.8" width="7.6" height="7.6" rx="1.8"/>
    <rect class="ic" x="15.9" y="5.1" width="3" height="3" rx=".8"/>`,
  trade: `
    <rect class="ib" x="6.6" y="4.6" width="6.4" height="5.6" rx="1.2"/>
    <rect class="ic" x="13.6" y="6.6" width="4.6" height="3.6" rx="1"/>
    <path class="ia" d="M2.8 11h18.4a.6.6 0 01.6.8l-1.9 5.8a1.4 1.4 0 01-1.3 1H5.4a1.4 1.4 0 01-1.3-1L2.2 11.8a.6.6 0 01.6-.8z"/>
    <rect class="ic" x="2" y="20" width="20" height="2" rx="1" opacity=".45"/>`,
  stock: `
    <rect class="ia" x="3" y="12.2" width="8.8" height="8.8" rx="1.6"/>
    <rect class="ib" x="12.4" y="12.2" width="8.6" height="8.8" rx="1.6"/>
    <rect class="ic" x="7.6" y="3" width="8.8" height="8.4" rx="1.6"/>`,
  ledger: `
    <circle class="ia" cx="9" cy="9.4" r="6.6"/>
    <circle class="ib" cx="15.4" cy="15" r="6.6" opacity=".93"/>
    <rect class="ic" x="14.5" y="11.4" width="1.8" height="7.2" rx=".9"/>
    <rect class="ic" x="12.9" y="14.1" width="5" height="1.8" rx=".9"/>`,
  docs: `
    <rect class="ib" x="8" y="2.5" width="12" height="15" rx="2.2"/>
    <rect class="ia" x="4" y="6.5" width="12" height="15" rx="2.2"/>
    <rect class="iw" x="6.5" y="10.4" width="7" height="1.8" rx=".9"/>
    <rect class="iw" x="6.5" y="13.9" width="7" height="1.8" rx=".9"/>
    <rect class="iw" x="6.5" y="17.4" width="4.2" height="1.8" rx=".9"/>`,
  finance: `
    <rect class="ic" x="3" y="13" width="4.6" height="8" rx="1.3"/>
    <rect class="ia" x="9.7" y="8" width="4.6" height="13" rx="1.3"/>
    <rect class="ib" x="16.4" y="3" width="4.6" height="18" rx="1.3"/>`,
  contracts: `
    <rect class="ia" x="4" y="2.5" width="14" height="18" rx="2.2"/>
    <rect class="iw" x="7" y="6.4" width="8" height="1.8" rx=".9"/>
    <rect class="iw" x="7" y="9.9" width="8" height="1.8" rx=".9"/>
    <circle class="ib" cx="16.6" cy="17" r="5"/>
    <path class="is" d="M14.3 17.1l1.6 1.6 3-3.3"/>`,
  hr: `
    <path class="ic" d="M13.4 20.6c.2-3.2 1.7-5.2 3.7-5.2 2.9 0 4.9 2.2 4.9 5.2z" opacity=".6"/>
    <circle class="ic" cx="17" cy="9.2" r="2.9"/>
    <path class="ia" d="M2 20.6C2 17 4.9 14 8.5 14s6.5 3 6.5 6.6z"/>
    <circle class="ib" cx="8.5" cy="7.5" r="3.6"/>`,
  prices: `
    <rect class="ic" x="3" y="6" width="18" height="2" rx="1" opacity=".4"/>
    <circle class="ia" cx="9" cy="7" r="3.2"/>
    <rect class="ic" x="3" y="16" width="18" height="2" rx="1" opacity=".4"/>
    <circle class="ib" cx="15" cy="17" r="3.2"/>`,
  meetings: `
    <rect class="ia" x="3" y="5" width="18" height="16" rx="2.600"/>
    <rect class="ib" x="3" y="5" width="18" height="5.400" rx="2.600"/>
    <rect class="ic" x="7" y="2.600" width="2.200" height="5" rx="1.100"/>
    <rect class="ic" x="14.800" y="2.600" width="2.200" height="5" rx="1.100"/>
    <rect class="iw" x="6.500" y="13" width="3.400" height="3.400" rx=".8"/>
    <rect class="ib" x="11.300" y="13" width="3.400" height="3.400" rx=".8"/>`,
  discuss: `
    <path class="ia" d="M3 5.6A2.6 2.6 0 015.6 3h8.8A2.6 2.6 0 0117 5.6v5.8a2.6 2.6 0 01-2.6 2.600H8.600L4.700 17.100a.5.500 0 01-.800-.400V13.800A2.600 2.600 0 013 11.400z"/>
    <path class="ib" d="M9.400 10.600A2.400 2.400 0 0111.800 8.200h6.800A2.400 2.400 0 0121 10.600v4.800a2.400 2.400 0 01-.900 1.900v2.500a.5.500 0 01-.800.400l-3.300-2.400h-4.200a2.400 2.400 0 01-2.400-2.400z"/>
    <rect class="iw" x="12" y="11.400" width="6.400" height="1.600" rx=".8"/>
    <rect class="iw" x="12" y="14.200" width="4" height="1.600" rx=".8"/>`,
  apps: `
    <rect class="ia" x="3" y="3" width="8" height="8" rx="2"/>
    <rect class="ib" x="13" y="3" width="8" height="8" rx="2"/>
    <rect class="ic" x="3" y="13" width="8" height="8" rx="2"/>
    <rect class="ia" x="13" y="13" width="8" height="8" rx="2" opacity=".55"/>`,
  access: `
    <path class="ia" d="M12 2.500l8 3v5.700c0 4.700-3.200 8.600-8 10.300-4.800-1.700-8-5.600-8-10.300V5.500z"/>
    <circle class="ib" cx="12" cy="9.600" r="2.600"/>
    <rect class="ib" x="11" y="11.400" width="2" height="5.200" rx="1"/>`,
  company: `
    <rect class="ia" x="4" y="3" width="10" height="18" rx="1.600"/>
    <rect class="ib" x="13" y="9" width="7.500" height="12" rx="1.600"/>
    <rect class="iw" x="6.500" y="6" width="2" height="2" rx=".5"/><rect class="iw" x="9.800" y="6" width="2" height="2" rx=".5"/>
    <rect class="iw" x="6.500" y="10" width="2" height="2" rx=".5"/><rect class="iw" x="9.800" y="10" width="2" height="2" rx=".5"/>
    <rect class="ic" x="7.800" y="15.500" width="2.600" height="5.500" rx=".8"/>`,
  links: `
    <rect class="ia" x="2.500" y="8.500" width="11" height="7" rx="3.500"/>
    <rect class="ib" x="10.500" y="8.500" width="11" height="7" rx="3.500" opacity=".92"/>
    <rect class="iw" x="8" y="11.100" width="8" height="1.800" rx=".9"/>`,
  backup: `
    <path class="ia" d="M7 19.4a5 5 0 01-.6-9.96A6.5 6.5 0 0118.9 11 4.2 4.2 0 0118 19.4z"/>
    <path class="ib" d="M12 9.2l4 4.2h-2.6v3.8h-2.8v-3.8H8z"/>`,
};
