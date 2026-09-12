// The stylesheet for the Manage area: the directory (the Manage menu), the settings page and the toasts.
// One status vocabulary (.mg-st), one ledger (.mg-ledger), one save bar (.mg-savebar); everything else is quiet.
// Tokens ride on the office's own --cream / --ink / --grey / --hairline so light and dark follow the office.
export const MANAGE_CSS = `
:root{--mg-rail:#F4F4ED;--mg-card:#FFFFFF;--mg-line2:rgba(22,21,20,.28);--mg-hover:rgba(22,21,20,.045);--mg-mute:#9C9B93;
  --mg-ok:#1E7A55;--mg-ok-bg:#E9F5EE;--mg-fail:#B2382C;--mg-fail-bg:#FBECEA;--mg-warn:#8F6407;--mg-warn-bg:#FBF3DC;--mg-busy:#2E5EA8;--mg-busy-bg:#E8EFFA;--mg-gold:#B9A775;
  --mg-shadow:0 14px 36px rgba(22,21,20,.10),0 1px 2px rgba(22,21,20,.06);--mg-mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace}
body.dark{--mg-rail:#121316;--mg-card:#1E1F23;--mg-line2:rgba(236,234,226,.32);--mg-hover:rgba(236,234,226,.06);--mg-mute:#6E6D67;
  --mg-ok:#5CC292;--mg-ok-bg:rgba(92,194,146,.13);--mg-fail:#F0857A;--mg-fail-bg:rgba(240,133,122,.13);--mg-warn:#E4B75B;--mg-warn-bg:rgba(228,183,91,.13);--mg-busy:#84ADEC;--mg-busy-bg:rgba(132,173,236,.13);--mg-gold:#CDBB86;
  --mg-shadow:0 18px 44px rgba(0,0,0,.55),0 1px 0 rgba(255,255,255,.04)}

/* ---- atoms shared by the directory, the page and the toasts ---- */
.mg-eyebrow{font:500 10.5px/1 var(--mg-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--grey)}
.mg-mono{font-family:var(--mg-mono)}
.mg-muted{color:var(--grey)}
.mg-spacer{flex:1}
.mg-st{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 7px;border-radius:99px;border:1px solid var(--hairline);font:500 11px/1.2 var(--mg-mono);letter-spacing:.03em;white-space:nowrap;vertical-align:middle;max-width:100%}
.mg-st i{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.mg-st-ok{color:var(--mg-ok);background:var(--mg-ok-bg);border-color:transparent}
.mg-st-fail{color:var(--mg-fail);background:var(--mg-fail-bg);border-color:transparent}
.mg-st-warn{color:var(--mg-warn);background:var(--mg-warn-bg);border-color:transparent}
.mg-st-busy{color:var(--mg-busy);background:var(--mg-busy-bg);border-color:transparent}
.mg-st-busy i{animation:mgPulse 1s ease-in-out infinite}
.mg-st-off{color:var(--grey)} .mg-st-off i{background:var(--mg-mute)}
@keyframes mgPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}
.mg-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex:none}
.mg-dot-ok{background:var(--mg-ok)} .mg-dot-fail{background:var(--mg-fail)} .mg-dot-warn{background:var(--mg-warn)} .mg-dot-busy{background:var(--mg-busy);animation:mgPulse 1s infinite} .mg-dot-off{background:var(--mg-mute)}
.mg-chip{display:inline-block;padding:2px 8px;border:1px solid var(--hairline);border-radius:99px;font:500 10.5px var(--mg-mono);letter-spacing:.04em;color:var(--grey);white-space:nowrap}
.mg-chip-ink{color:var(--ink);border-color:var(--mg-line2)}
.mg-chips{display:flex;flex-wrap:wrap;gap:4px}
@media (prefers-reduced-motion:reduce){.mg-st-busy i,.mg-dot-busy,.mg-spin{animation:none!important}}

/* ---- the directory: the Manage menu ---- */
#spaceManage{display:flex;align-items:center;gap:7px;padding:6px 11px;border:1px solid var(--mg-line2);border-radius:99px;background:transparent;color:var(--ink);font:500 11px var(--ui);letter-spacing:.02em;cursor:pointer}
#spaceManage:hover,#spaceManage[aria-expanded=true]{background:var(--mg-hover)}
#spaceManage .mg-dot{margin-left:2px}
#spaceManageMenu{position:fixed;z-index:39;top:60px;right:14px;width:min(920px,calc(100vw - 28px));padding:0;background:var(--mg-card);border:1px solid var(--hairline);border-radius:14px;box-shadow:var(--mg-shadow);overflow:hidden;color:var(--ink);text-align:left}
#spaceManageMenu[hidden]{display:none}
.mg-dir-head{display:flex;align-items:center;gap:14px;padding:13px 20px;border-bottom:1px solid var(--hairline);background:var(--mg-rail)}
.mg-dir-head h2{margin:0;font:400 22px var(--serif)}
.mg-dir-head .mg-needs{display:flex;align-items:center;gap:8px;margin-left:auto;font:12px var(--ui);color:var(--grey)}
.mg-dir-head .mg-needs b{font-weight:600;color:var(--ink)}
.mg-dir-attn{padding:10px 20px;border-bottom:1px solid var(--hairline);display:flex;flex-direction:column;gap:6px}
.mg-dir-attn:empty{display:none}
.mg-attn{display:flex;align-items:center;gap:10px;font:12.5px var(--ui);min-width:0}
.mg-attn>span:nth-child(2){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mg-attn .mg-when{font:11px var(--mg-mono);color:var(--grey);white-space:nowrap}
.mg-attn button{border:1px solid var(--hairline);background:transparent;color:var(--ink);border-radius:6px;padding:3px 9px;font:500 11.5px var(--ui);cursor:pointer;white-space:nowrap}
.mg-attn button:hover{background:var(--mg-hover)}
.mg-dir-body{display:grid;grid-template-columns:repeat(4,1fr)}
.mg-dir-col{padding:12px 8px 14px;border-right:1px solid var(--hairline);min-width:0}
.mg-dir-col:last-child{border-right:0}
.mg-dir-col .mg-eyebrow{display:block;padding:4px 10px 8px}
#spaceManageMenu .mg-dir-item{display:grid;grid-template-columns:1fr auto;gap:1px 10px;width:100%;text-align:left;background:transparent;border:0;border-radius:8px;padding:8px 10px;color:var(--ink);cursor:pointer;font:500 13px var(--ui)}
#spaceManageMenu .mg-dir-item:hover{background:var(--mg-hover)}
#spaceManageMenu .mg-dir-item small{grid-column:1;font:11px var(--mg-mono);color:var(--grey);letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#spaceManageMenu .mg-dir-item .mg-dot{grid-column:2;grid-row:1;align-self:center;margin-top:2px}
#spaceManageMenu #claudeConnect{display:grid;grid-template-columns:1fr auto;gap:1px 10px;width:100%;text-align:left;background:transparent;border:0;border-radius:8px;padding:8px 10px;color:var(--ink);font:500 13px var(--ui);cursor:pointer}
#spaceManageMenu #claudeConnect:hover{background:var(--mg-hover)}
#spaceManageMenu #claudeConnect::after{content:'';grid-column:2;grid-row:1;align-self:center;width:7px;height:7px;border-radius:50%;background:var(--mg-mute)}
#spaceManageMenu #claudeConnect.connected::after{background:var(--mg-ok)}
.mg-dir-foot{display:flex;gap:16px;align-items:center;padding:11px 20px;border-top:1px solid var(--hairline);font:11.5px var(--ui);color:var(--grey)}
.mg-dir-foot .mg-st{margin-left:auto}
@media (max-width:860px){.mg-dir-body{grid-template-columns:1fr 1fr}.mg-dir-col:nth-child(2){border-right:0}.mg-dir-col{border-bottom:1px solid var(--hairline)}}
@media (max-width:560px){.mg-dir-body{grid-template-columns:1fr}.mg-dir-col{border-right:0}#spaceManageMenu{right:8px;left:8px;width:auto;max-height:calc(100dvh - 70px);overflow:auto}}

/* ---- the page: rail + sheet ---- */
#settingsPage.mg{position:fixed;inset:52px 0 0 0;z-index:30;display:grid;grid-template-columns:248px minmax(0,1fr);background:var(--cream);color:var(--ink)}
#settingsPage.mg[hidden]{display:none}
#settingsPage.mg .mg-rail{background:var(--mg-rail);border-right:1px solid var(--hairline);padding:16px 14px 24px;overflow:auto;overscroll-behavior:contain}
#settingsPage.mg .mg-back{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;text-decoration:none;font:500 12px var(--ui);color:var(--grey);margin-bottom:12px}
#settingsPage.mg .mg-back:hover{background:var(--mg-hover);color:var(--ink)}
#settingsPage.mg .mg-rail .mg-eyebrow{display:block;padding:14px 10px 6px}
#settingsPage.mg .mg-rail a[data-section]{display:flex;align-items:center;gap:8px;text-decoration:none;border-radius:8px;padding:8px 10px;font:13px var(--ui);color:var(--grey)}
#settingsPage.mg .mg-rail a[data-section]:hover{background:var(--mg-hover);color:var(--ink)}
#settingsPage.mg .mg-rail a[aria-current=page]{background:var(--mg-card);color:var(--ink);font-weight:500;box-shadow:0 0 0 1px var(--hairline)}
#settingsPage.mg .mg-rail a[data-section] .mg-meta{margin-left:auto;display:flex;align-items:center;gap:6px;font:11px var(--mg-mono);color:var(--mg-mute)}
#settingsPage.mg .mg-rail-office{margin-top:22px;padding:12px 10px;border-top:1px solid var(--hairline);font:11px/1.6 var(--mg-mono);color:var(--grey)}
#settingsPage.mg .mg-rail-office b{display:block;font:400 15px var(--serif);color:var(--ink);letter-spacing:.02em}
#settingsPage.mg .settings-main{overflow:auto;overscroll-behavior:contain;padding:26px clamp(18px,3.4vw,40px) 120px}
#settingsPage.mg .settings-main>*{max-width:1180px}
#settingsPage.mg[data-section=projects] .settings-main>*{max-width:1680px}
#settingsPage.mg .mg-area-head{display:grid;grid-template-columns:1fr auto;gap:8px 24px;align-items:end;padding-bottom:18px;border-bottom:1px solid var(--mg-line2);margin-bottom:22px}
#settingsPage.mg .mg-area-head h1{margin:6px 0 4px;font:400 36px/1.05 var(--serif);letter-spacing:-.005em}
#settingsPage.mg .mg-area-head p{margin:0;max-width:64ch;color:var(--grey);font:13px/1.55 var(--ui)}
#settingsPage.mg .mg-area-meta{display:flex;flex-direction:column;align-items:flex-end;gap:8px;font:11px var(--mg-mono);color:var(--grey);white-space:nowrap}
#settingsPage.mg .mg-area-meta:empty{display:none}
#settingsPage.mg #settingsMessage{display:none}
#settingsPage.mg #settingsMessage.error{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:10px;border:1px solid color-mix(in srgb,var(--mg-fail) 35%,transparent);background:var(--mg-fail-bg);color:var(--ink);font:12.5px/1.5 var(--ui);margin:0 0 18px}
#settingsPage.mg #settingsMessage.error::before{content:'✕';width:18px;height:18px;border-radius:50%;flex:none;display:grid;place-items:center;font:700 11px var(--mg-mono);color:#fff;background:var(--mg-fail)}
#settingsPage.mg #settingsContent{font:13px/1.55 var(--ui)}
#settingsPage.mg #settingsContent>p:first-child,#settingsPage.mg .mg-intro{color:var(--grey);font:13px/1.55 var(--ui);margin:0 0 18px;max-width:70ch}
#settingsPage.mg .mg-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 18px}
#settingsPage.mg .mg-toolbar label{margin:0;display:flex;align-items:center;gap:8px;font:12px var(--ui);color:var(--grey)}
#settingsPage.mg .mg-toolbar label input,#settingsPage.mg .mg-toolbar label select{width:auto;margin:0;padding:7px 10px;border:1px solid var(--hairline);border-radius:8px;background:var(--mg-card);color:var(--ink);font:12.5px var(--ui)}
#settingsPage.mg .mg-search{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px;border:1px solid var(--hairline);border-radius:8px;background:var(--mg-card);min-width:240px}
#settingsPage.mg .mg-search input{border:0;background:transparent;outline:0;width:100%;margin:0;padding:0;font:12.5px var(--ui);color:var(--ink)}
#settingsPage.mg .mg-search svg{color:var(--mg-mute);flex:none}
#settingsPage.mg .mg-filters{display:flex;gap:6px;flex-wrap:wrap}
#settingsPage.mg .mg-filters button{border:1px solid var(--hairline);background:transparent;border-radius:99px;padding:5px 11px;font:500 11.5px var(--ui);color:var(--grey);cursor:pointer}
#settingsPage.mg .mg-filters button:hover{color:var(--ink)}
#settingsPage.mg .mg-filters button[aria-pressed=true]{background:var(--ink);color:var(--cream);border-color:var(--ink)}
#settingsPage.mg .mg-count{font:11px var(--mg-mono);color:var(--grey)}

/* buttons */
#settingsPage.mg .mg-btn,#settingsPage.mg .secondary,#settingsPage.mg button:where(:not(.mg-btn):not(.mg-switch):not(.mg-tab):not(.mg-team-tab):not(.mg-filters button):not(.space-text-action):not(.mg-link):not(.mg-attn button):not(.agency-close)){display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--mg-line2);background:transparent;font:500 12.5px var(--ui);color:var(--ink);white-space:nowrap;cursor:pointer;letter-spacing:0;text-transform:none}
#settingsPage.mg .mg-btn:hover,#settingsPage.mg .secondary:hover{background:var(--mg-hover)}
#settingsPage.mg .mg-btn-primary,#settingsPage.mg button[type=submit]:not(.secondary):not(.mg-btn-sm){background:var(--ink);color:var(--cream);border-color:var(--ink)}
#settingsPage.mg .mg-btn-primary:hover,#settingsPage.mg button[type=submit]:not(.secondary):hover{background:color-mix(in srgb,var(--ink) 86%,var(--cream))}
#settingsPage.mg .mg-btn-sm{height:28px;padding:0 10px;font-size:11.5px;border-radius:6px}
#settingsPage.mg .mg-btn-danger{color:var(--mg-fail);border-color:color-mix(in srgb,var(--mg-fail) 40%,transparent)}
#settingsPage.mg .mg-btn-danger:hover{background:var(--mg-fail-bg)}
#settingsPage.mg .mg-btn-text,#settingsPage.mg .space-text-action{border-color:transparent;background:transparent;padding:0 8px;height:28px;font:500 11.5px var(--ui);color:var(--grey);border-radius:6px;cursor:pointer}
#settingsPage.mg .mg-btn-text:hover,#settingsPage.mg .space-text-action:hover{color:var(--ink);background:var(--mg-hover)}
#settingsPage.mg .mg-link{background:none;border:0;padding:0;color:var(--ink);font:inherit;cursor:pointer;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--mg-line2);text-align:left}
#settingsPage.mg .mg-link:hover{text-decoration-color:var(--ink)}
#settingsPage.mg button:disabled{opacity:.5;cursor:default}
#settingsPage.mg .mg-spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:mgSpin .8s linear infinite;display:inline-block}
@keyframes mgSpin{to{transform:rotate(360deg)}}

/* banners */
#settingsPage.mg .mg-banner{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:10px;border:1px solid;margin:0 0 18px;font:12.5px/1.5 var(--ui);color:var(--ink)}
#settingsPage.mg .mg-banner b{font-weight:600}
#settingsPage.mg .mg-banner .mg-actions{margin-left:auto;display:flex;gap:8px;flex:none}
#settingsPage.mg .mg-banner-fail{border-color:color-mix(in srgb,var(--mg-fail) 35%,transparent);background:var(--mg-fail-bg)}
#settingsPage.mg .mg-banner-warn{border-color:color-mix(in srgb,var(--mg-warn) 40%,transparent);background:var(--mg-warn-bg)}
#settingsPage.mg .mg-banner-ok{border-color:color-mix(in srgb,var(--mg-ok) 35%,transparent);background:var(--mg-ok-bg)}
#settingsPage.mg .mg-banner-info{border-color:color-mix(in srgb,var(--mg-busy) 35%,transparent);background:var(--mg-busy-bg)}
#settingsPage.mg .mg-banner .mg-glyph{width:18px;height:18px;border-radius:50%;flex:none;display:grid;place-items:center;font:700 11px var(--mg-mono);color:#fff;margin-top:1px}
#settingsPage.mg .mg-banner-fail .mg-glyph{background:var(--mg-fail)} #settingsPage.mg .mg-banner-warn .mg-glyph{background:var(--mg-warn)} #settingsPage.mg .mg-banner-ok .mg-glyph{background:var(--mg-ok)} #settingsPage.mg .mg-banner-info .mg-glyph{background:var(--mg-busy)}

/* the ledger */
#settingsPage.mg .mg-ledger-wrap{border:1px solid var(--hairline);border-radius:10px;overflow:auto;background:var(--mg-card);margin:0 0 16px}
#settingsPage.mg .mg-ledger{width:100%;border-collapse:collapse;background:var(--mg-card)}
#settingsPage.mg .mg-ledger th{font:500 10.5px var(--mg-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--grey);text-align:left;padding:10px 14px;border-bottom:1px solid var(--hairline);background:var(--mg-rail);white-space:nowrap}
#settingsPage.mg .mg-ledger td{padding:12px 14px;border-bottom:1px solid var(--hairline);vertical-align:middle;font:12.5px/1.5 var(--ui);color:var(--ink)}
#settingsPage.mg .mg-ledger tr:last-child td{border-bottom:0}
#settingsPage.mg .mg-ledger tbody tr:hover td{background:var(--mg-hover)}
#settingsPage.mg .mg-ledger td.k{font-family:var(--mg-mono);font-size:12px;white-space:nowrap}
#settingsPage.mg .mg-ledger td .mg-sub,#settingsPage.mg .mg-sub{display:block;font:11px/1.5 var(--mg-mono);color:var(--grey);margin-top:3px;white-space:normal}
#settingsPage.mg .mg-ledger td.r{text-align:right;white-space:nowrap}
#settingsPage.mg .mg-ledger td.r>*{vertical-align:middle}
#settingsPage.mg .mg-ledger td.r>*+*{margin-left:8px}
#settingsPage.mg .mg-ledger .mg-name{font-weight:500}
#settingsPage.mg .mg-ledger td.mg-empty{padding:28px 14px;text-align:center;color:var(--grey)}
#settingsPage.mg .mg-key{font-family:var(--mg-mono);font-size:12px;letter-spacing:.02em}
#settingsPage.mg .mg-key .mg-mask{color:var(--mg-mute)}
#settingsPage.mg .mg-ledger tr.mg-row{cursor:pointer}
#settingsPage.mg .mg-ledger td.mg-diffcell{padding:0;background:var(--mg-rail)}
#settingsPage.mg .mg-ledger pre.mg-diff{margin:0;padding:12px 16px 14px 56px;font:11.5px/1.6 var(--mg-mono);color:var(--grey);white-space:pre-wrap;border:0;max-height:none;overflow:visible;background:transparent;border-radius:0}
#settingsPage.mg .mg-diff .del{color:var(--mg-fail)} #settingsPage.mg .mg-diff .add{color:var(--mg-ok)}

/* forms */
#settingsPage.mg .mg-card{background:var(--mg-card);border:1px solid var(--hairline);border-radius:12px;padding:20px 22px;margin:0 0 16px;min-width:0}
#settingsPage.mg .mg-card h3{margin:0 0 4px;font:400 22px var(--serif);color:var(--ink)}
#settingsPage.mg .mg-card>p{margin:0 0 16px;color:var(--grey);font:12.5px/1.5 var(--ui)}
#settingsPage.mg .mg-card-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
#settingsPage.mg .mg-card-head h3{margin:0}
#settingsPage.mg .mg-card-head .mg-st,#settingsPage.mg .mg-card-head .mg-search{margin-left:auto}
#settingsPage.mg .mg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px 24px}
#settingsPage.mg .mg-field{display:flex;flex-direction:column;gap:6px;position:relative;margin:0 0 14px;font:12px/1.5 var(--ui)}
#settingsPage.mg .mg-grid .mg-field{margin:0}
#settingsPage.mg .mg-field>span{font:500 12px var(--ui);color:var(--ink)}
#settingsPage.mg .mg-field small{color:var(--grey);font:11.5px/1.5 var(--ui)}
#settingsPage.mg .mg-field input:not([type=checkbox]),#settingsPage.mg .mg-field select,#settingsPage.mg .mg-field textarea{display:block;width:100%;box-sizing:border-box;margin:0;border:1px solid var(--mg-line2);border-radius:8px;padding:9px 11px;background:var(--mg-card);color:var(--ink);font:13px/1.5 var(--ui);transition:border-color .12s,box-shadow .12s}
#settingsPage.mg .mg-field textarea{min-height:88px;resize:vertical;line-height:1.55}
#settingsPage.mg .mg-field input:focus,#settingsPage.mg .mg-field select:focus,#settingsPage.mg .mg-field textarea:focus{outline:0;border-color:var(--mg-busy);box-shadow:0 0 0 3px var(--mg-busy-bg)}
#settingsPage.mg .mg-field input:invalid:not(:placeholder-shown),#settingsPage.mg .mg-field textarea:invalid:not(:placeholder-shown){border-color:color-mix(in srgb,var(--mg-fail) 60%,transparent)}
#settingsPage.mg .mg-field.changed::before{content:"";position:absolute;left:-14px;top:24px;bottom:0;width:3px;border-radius:2px;background:var(--mg-warn)}
#settingsPage.mg .mg-check{display:flex;align-items:center;gap:10px;margin:8px 0;font:12.5px/1.5 var(--ui);color:var(--ink)}
#settingsPage.mg .mg-check small{color:var(--grey);font-size:11.5px}
#settingsPage.mg .mg-switch{appearance:none;-webkit-appearance:none;position:relative;width:34px;height:20px;border-radius:99px;background:var(--mg-mute);border:0;flex:none;transition:background .15s;cursor:pointer;margin:0;padding:0;display:inline-block;vertical-align:middle}
#settingsPage.mg .mg-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
#settingsPage.mg .mg-switch:checked{background:var(--mg-ok)}
#settingsPage.mg .mg-switch:checked::after{transform:translateX(14px)}
#settingsPage.mg .mg-switch:focus-visible{outline:2px solid var(--mg-busy);outline-offset:2px}
#settingsPage.mg .mg-picks{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin:6px 0 14px}
#settingsPage.mg .mg-picks .mg-check{margin:0;border:1px solid var(--hairline);border-radius:8px;padding:9px 12px;background:var(--mg-card)}
#settingsPage.mg .mg-picks .mg-check:has(:checked){border-color:var(--mg-line2)}
#settingsPage.mg .mg-picks .mg-check span{flex:1;min-width:0}
#settingsPage.mg .mg-picks .mg-check small{display:block}
#settingsPage.mg .mg-subnav{display:flex;gap:2px;border-bottom:1px solid var(--hairline);margin:0 0 20px;overflow:auto}
#settingsPage.mg .mg-subnav .mg-tab{background:transparent;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:10px 12px;font:500 12.5px var(--ui);color:var(--grey);cursor:pointer;white-space:nowrap;border-radius:0}
#settingsPage.mg .mg-subnav .mg-tab:hover{color:var(--ink)}
#settingsPage.mg .mg-subnav .mg-tab[aria-pressed=true],#settingsPage.mg .mg-subnav .mg-tab[aria-selected=true]{color:var(--ink);border-bottom-color:var(--ink)}
#settingsPage.mg .mg-subnav .mg-tab .mg-n{font:11px var(--mg-mono);color:var(--mg-mute);margin-left:6px}
#settingsPage.mg details.mg-fold{border:1px solid var(--hairline);border-radius:10px;padding:0;margin:0 0 10px;background:var(--mg-card)}
#settingsPage.mg details.mg-fold>summary{cursor:pointer;padding:12px 16px;font:500 13px/1.5 var(--ui);list-style:none;display:flex;align-items:center;gap:12px}
#settingsPage.mg details.mg-fold>summary::-webkit-details-marker{display:none}
#settingsPage.mg details.mg-fold>summary small{font:11px var(--mg-mono);color:var(--grey);font-weight:400}
#settingsPage.mg details.mg-fold>summary .mg-open{margin-left:auto;font:500 11.5px var(--ui);color:var(--grey)}
#settingsPage.mg details.mg-fold[open]>summary{border-bottom:1px solid var(--hairline)}
#settingsPage.mg details.mg-fold>.mg-fold-body{padding:16px}

/* the save bar: the one place that always tells the truth about what is saved */
#settingsPage.mg .mg-savebar{position:sticky;bottom:12px;z-index:5;display:flex;align-items:center;gap:14px;margin-top:22px;padding:10px 12px 10px 16px;border:1px solid var(--mg-line2);border-radius:12px;background:var(--mg-card);box-shadow:var(--mg-shadow)}
#settingsPage.mg .mg-savebar .mg-savemsg{font:12.5px/1.4 var(--ui);color:var(--ink)}
#settingsPage.mg .mg-savebar .mg-savemsg small{display:block;color:var(--grey);font-size:11.5px}
#settingsPage.mg .mg-savebar[data-state=idle]{border-color:var(--hairline);box-shadow:0 -8px 24px -12px rgba(22,21,20,.18);background:var(--mg-card)}
#settingsPage.mg .mg-savebar[data-state=idle] [data-mark]{display:none}
#settingsPage.mg .mg-savebar[data-state=dirty]{border-color:color-mix(in srgb,var(--mg-warn) 50%,transparent)}
#settingsPage.mg .mg-savebar[data-state=failed]{border-color:color-mix(in srgb,var(--mg-fail) 55%,transparent)}
#settingsPage.mg .mg-savebar[data-state=saved]{border-color:color-mix(in srgb,var(--mg-ok) 55%,transparent)}
#settingsPage.mg form.picker-open .mg-savebar{position:static}

/* teams */
#settingsPage.mg .mg-team-strip{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:22px}
#settingsPage.mg .mg-team-tab{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:132px;padding:10px 12px;border:1px solid var(--hairline);border-radius:10px;background:var(--mg-card);text-align:left;cursor:pointer;color:var(--ink)}
#settingsPage.mg .mg-team-tab b{font:500 12.5px var(--ui)}
#settingsPage.mg .mg-team-tab small{font:11px var(--mg-mono);color:var(--grey)}
#settingsPage.mg .mg-team-tab:hover{border-color:var(--mg-line2)}
#settingsPage.mg .mg-team-tab[aria-selected=true]{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
#settingsPage.mg .mg-team-tab.mg-add{border-style:dashed;justify-content:center;color:var(--grey);background:transparent}
#settingsPage.mg .mg-team-head{display:flex;align-items:flex-end;gap:16px;margin-bottom:6px;flex-wrap:wrap}
#settingsPage.mg .mg-team-head h2{margin:0;font:400 30px/1 var(--serif)}
#settingsPage.mg .mg-team-head .mg-lead{font:12px var(--ui);color:var(--grey);display:flex;align-items:center;gap:6px;flex-wrap:wrap}
#settingsPage.mg .mg-team-head .mg-lead b{color:var(--ink);font-weight:500}
#settingsPage.mg .mg-team-head .mg-actions{margin-left:auto;display:flex;gap:8px}
#settingsPage.mg details.mg-person>summary{display:grid;grid-template-columns:44px minmax(0,1fr) auto auto;grid-template-areas:"av who facts edit" "av does does does";gap:6px 14px;align-items:center;padding:14px 18px;list-style:none;cursor:pointer}
#settingsPage.mg .mg-person>summary::-webkit-details-marker{display:none}
#settingsPage.mg .mg-avatar{grid-area:av;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:var(--mg-rail);border:1px solid var(--hairline);font:600 10px var(--mg-mono);letter-spacing:.06em;color:var(--grey);align-self:start}
#settingsPage.mg .mg-avatar.lead{border-color:var(--mg-gold);color:var(--mg-gold);box-shadow:0 0 0 2px color-mix(in srgb,var(--mg-gold) 25%,transparent)}
#settingsPage.mg .mg-person .mg-who{grid-area:who;min-width:0}
#settingsPage.mg .mg-person .mg-who b{display:block;font:600 13.5px var(--ui);color:var(--ink)}
#settingsPage.mg .mg-person .mg-who span{font:11.5px var(--ui);color:var(--grey)}
#settingsPage.mg .mg-person .mg-does{grid-area:does;color:var(--grey);font:12.5px/1.5 var(--ui);max-width:78ch}
#settingsPage.mg .mg-person .mg-does.mg-missing{color:var(--mg-warn)}
#settingsPage.mg .mg-person .mg-facts{grid-area:facts;display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
#settingsPage.mg .mg-person .mg-open{grid-area:edit;margin-left:0;font:500 11.5px var(--ui);color:var(--ink);border:1px solid var(--mg-line2);border-radius:6px;padding:4px 10px}
#settingsPage.mg .mg-assist{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:99px;border:1px solid var(--mg-gold);background:color-mix(in srgb,var(--mg-gold) 16%,transparent);color:#6E5A1C;font:600 11px var(--ui);cursor:pointer;white-space:nowrap}
#settingsPage.mg .mg-assist:hover{background:color-mix(in srgb,var(--mg-gold) 30%,transparent)}
body.dark #settingsPage.mg .mg-assist{color:#E4C97A}
#settingsPage.mg details.mg-person[open]>summary{border-bottom:1px solid var(--hairline)}
#settingsPage.mg .mg-person .mg-fold-body h4{margin:18px 0 8px;font:500 10.5px var(--mg-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--grey)}
#settingsPage.mg .mg-rules td:first-child{width:60%}

/* a small modal: one question, two ways to answer it */
#settingsPage.mg .mg-modal{position:fixed;inset:0;z-index:40;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--ink) 38%,transparent);backdrop-filter:blur(2px);animation:mgFade .15s ease-out}
#settingsPage.mg .mg-modal[hidden]{display:none}
@keyframes mgFade{from{opacity:0}to{opacity:1}}
#settingsPage.mg .mg-modal-box{width:min(620px,100%);background:var(--mg-card);border:1px solid var(--hairline);border-radius:14px;box-shadow:var(--mg-shadow);overflow:hidden}
#settingsPage.mg .mg-modal-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--hairline);background:var(--mg-rail)}
#settingsPage.mg .mg-modal-head h3{margin:0;font:400 22px var(--serif)}
#settingsPage.mg .mg-modal-x{margin-left:auto;border:0;background:transparent;color:var(--grey);font-size:15px;line-height:1;padding:4px 6px;cursor:pointer;height:auto}
#settingsPage.mg .mg-modal-x:hover{color:var(--ink)}
#settingsPage.mg .mg-choices{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:18px 20px 20px}
#settingsPage.mg .mg-choice{display:flex;flex-direction:column;align-items:flex-start;gap:6px;height:auto;padding:16px;border:1px solid var(--mg-line2);border-radius:12px;background:transparent;text-align:left;cursor:pointer;color:var(--ink);white-space:normal}
#settingsPage.mg .mg-choice:hover:not(:disabled){border-color:var(--ink);background:var(--mg-hover)}
#settingsPage.mg .mg-choice:disabled{opacity:.55;cursor:default}
#settingsPage.mg .mg-choice b{font:600 14px var(--ui)}
#settingsPage.mg .mg-choice span{font:12px/1.5 var(--ui);color:var(--grey)}
#settingsPage.mg .mg-choice em{margin-top:2px;font:500 10.5px var(--mg-mono);letter-spacing:.08em;text-transform:uppercase;font-style:normal;color:var(--mg-gold)}
@media (max-width:620px){#settingsPage.mg .mg-choices{grid-template-columns:1fr}}

/* routines: a timetable */
#settingsPage.mg .mg-timetable{display:grid;grid-template-columns:52px repeat(7,1fr);border:1px solid var(--hairline);border-radius:10px;overflow:hidden;background:var(--mg-card);margin-bottom:18px}
#settingsPage.mg .mg-timetable .hd{padding:8px 6px;font:500 10.5px var(--mg-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--grey);border-bottom:1px solid var(--hairline);border-right:1px solid var(--hairline);background:var(--mg-rail);text-align:center}
#settingsPage.mg .mg-timetable .hd:nth-child(8n){border-right:0}
#settingsPage.mg .mg-timetable .hr{font:10.5px var(--mg-mono);color:var(--mg-mute);border-right:1px solid var(--hairline);padding:4px 6px 0;display:flex;align-items:flex-start;justify-content:flex-end;min-height:36px;border-bottom:1px solid var(--hairline)}
#settingsPage.mg .mg-timetable .col{position:relative;border-right:1px solid var(--hairline);border-bottom:1px solid var(--hairline);min-height:36px;padding:3px;display:flex;flex-direction:column;gap:3px}
#settingsPage.mg .mg-timetable .col:nth-child(8n){border-right:0}
#settingsPage.mg .mg-timetable .col.wk{background:color-mix(in srgb,var(--mg-rail) 55%,transparent)}
#settingsPage.mg .mg-rt{height:26px;padding:0 8px;border-radius:6px;display:flex;align-items:center;gap:6px;font:500 10.5px var(--mg-mono);letter-spacing:.02em;overflow:hidden;white-space:nowrap;border:1px solid;text-overflow:ellipsis;min-width:0}
#settingsPage.mg .mg-rt-ok{background:var(--mg-ok-bg);border-color:color-mix(in srgb,var(--mg-ok) 40%,transparent);color:var(--mg-ok)}
#settingsPage.mg .mg-rt-warn{background:var(--mg-warn-bg);border-color:color-mix(in srgb,var(--mg-warn) 45%,transparent);color:var(--mg-warn)}
#settingsPage.mg .mg-rt-fail{background:var(--mg-fail-bg);border-color:color-mix(in srgb,var(--mg-fail) 45%,transparent);color:var(--mg-fail)}
#settingsPage.mg .mg-rt-off{background:transparent;border-style:dashed;border-color:var(--mg-line2);color:var(--grey)}

/* office settings: a control list */
#settingsPage.mg .mg-controls{border:1px solid var(--hairline);border-radius:12px;background:var(--mg-card);overflow:hidden;margin-bottom:4px}
#settingsPage.mg .mg-control{display:grid;grid-template-columns:1fr 220px;gap:6px 24px;padding:16px 20px;border-bottom:1px solid var(--hairline);align-items:center;position:relative;margin:0}
#settingsPage.mg .mg-control:last-child{border-bottom:0}
#settingsPage.mg .mg-control>span{font:500 13px var(--ui);color:var(--ink)}
#settingsPage.mg .mg-control small{grid-column:1;color:var(--grey);font:11.5px/1.5 var(--ui)}
#settingsPage.mg .mg-control .mg-ctl{grid-column:2;grid-row:1/3;display:flex;align-items:center;gap:8px;justify-content:flex-end}
#settingsPage.mg .mg-control input,#settingsPage.mg .mg-control select{display:block;width:120px;margin:0;border:1px solid var(--mg-line2);border-radius:8px;padding:8px 10px;background:var(--cream);color:var(--ink);font:13px var(--mg-mono);text-align:right}
#settingsPage.mg .mg-control input[type=text],#settingsPage.mg .mg-control input[type=url]{width:220px;text-align:left;font-family:var(--ui)}
#settingsPage.mg .mg-control input:focus,#settingsPage.mg .mg-control select:focus{outline:0;border-color:var(--mg-busy);box-shadow:0 0 0 3px var(--mg-busy-bg)}
#settingsPage.mg .mg-control .mg-unit{font:11px var(--mg-mono);color:var(--mg-mute);width:34px}
#settingsPage.mg .mg-control.changed::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--mg-warn)}
#settingsPage.mg .mg-control.invalid input{border-color:var(--mg-fail);box-shadow:0 0 0 3px var(--mg-fail-bg)}
#settingsPage.mg .mg-control .mg-err{display:none;grid-column:1/3;color:var(--mg-fail);font:12px var(--ui)}
#settingsPage.mg .mg-control.invalid .mg-err{display:block}

/* KPIs */
#settingsPage.mg .mg-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 18px}
#settingsPage.mg .mg-kpi{background:var(--mg-card);border:1px solid var(--hairline);border-radius:10px;padding:14px 16px}
#settingsPage.mg .mg-kpi b{display:block;font:400 28px/1.1 var(--serif);color:var(--ink);font-variant-numeric:tabular-nums}
#settingsPage.mg .mg-kpi span{display:block;margin-top:4px;font:11px/1.4 var(--mg-mono);color:var(--grey)}
#settingsPage.mg .mg-bars{display:flex;align-items:flex-end;gap:3px;height:56px;padding:0 2px;margin:0 0 6px}
#settingsPage.mg .mg-bars i{flex:1;background:var(--mg-ok);opacity:.7;border-radius:2px 2px 0 0;min-height:2px}

/* the Brain */
#settingsPage.mg .mg-brain{display:grid;grid-template-columns:200px minmax(0,1fr);gap:22px;align-items:start}
#settingsPage.mg .mg-folders{display:flex;flex-direction:column;gap:2px;position:sticky;top:0}
#settingsPage.mg .mg-folders button{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;border-radius:8px;padding:7px 10px;font:12.5px var(--ui);color:var(--grey);cursor:pointer;height:auto;justify-content:flex-start}
#settingsPage.mg .mg-folders button:hover{background:var(--mg-hover);color:var(--ink)}
#settingsPage.mg .mg-folders button[aria-pressed=true]{background:var(--mg-card);color:var(--ink);font-weight:500;box-shadow:0 0 0 1px var(--hairline)}
#settingsPage.mg .mg-folders button .mg-n{margin-left:auto;font:11px var(--mg-mono);color:var(--mg-mute)}
#settingsPage.mg .mg-upload{display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px dashed var(--mg-line2);border-radius:10px;padding:12px 14px;margin:0 0 16px;background:var(--mg-card)}
#settingsPage.mg .mg-upload input[type=file]{width:auto;margin:0;padding:0;border:0;background:transparent;font:12px var(--ui);color:var(--grey)}
#settingsPage.mg .mg-upload input::file-selector-button{border:1px solid var(--mg-line2);border-radius:6px;padding:6px 10px;margin-right:10px;background:transparent;color:var(--ink);font:500 12px var(--ui);cursor:pointer}
#settingsPage.mg .mg-upload small{color:var(--grey);font:11px var(--ui);width:100%}
#settingsPage.mg .mg-doc{background:var(--mg-card);border:1px solid var(--hairline);border-radius:12px;padding:28px 32px;max-width:820px}

/* ---- the project list: one row per project, what it is worth and who owns it ---- */
#settingsPage.mg .mg-goback{border:1px solid var(--mg-line2);background:var(--mg-card);color:var(--ink);font:600 12px var(--ui);padding:8px 14px;border-radius:9px}
#settingsPage.mg .mg-goback:hover{background:var(--mg-hover);border-color:var(--ink)}
#settingsPage.mg .mg-goback:focus-visible{outline:2px solid var(--mg-busy);outline-offset:2px}
#settingsPage.mg .pl-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px}
#settingsPage.mg .pl-tabs{display:inline-flex;padding:3px;border:1px solid var(--hairline);border-radius:10px;background:var(--mg-card)}
#settingsPage.mg .pl-tabs button{border:0;background:transparent;border-radius:7px;padding:6px 12px;font:500 12px var(--ui);color:var(--grey);cursor:pointer;height:auto;display:inline-flex;align-items:center;gap:6px}
#settingsPage.mg .pl-tabs button span{font:600 10.5px var(--mg-mono);opacity:.7}
#settingsPage.mg .pl-tabs button[aria-pressed=true]{background:var(--ink);color:var(--cream)}
#settingsPage.mg .pl-wrap{background:var(--mg-card);border:1px solid var(--hairline);border-radius:14px;overflow:hidden}
#settingsPage.mg table.pl{width:100%;border-collapse:collapse}
#settingsPage.mg table.pl th{text-align:left;padding:12px 18px;background:var(--mg-rail);border-bottom:1px solid var(--hairline);font:600 10px var(--mg-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--grey);white-space:nowrap}
#settingsPage.mg table.pl td{padding:16px 18px;border-bottom:1px solid var(--hairline);vertical-align:middle;font:12px var(--ui)}
#settingsPage.mg table.pl tbody tr:last-child td{border-bottom:0}
#settingsPage.mg table.pl .r{text-align:right}
#settingsPage.mg .pl-row{cursor:pointer}
#settingsPage.mg .pl-row:hover td{background:var(--mg-hover)}
#settingsPage.mg .pl-row:focus-visible td{background:var(--mg-hover);outline:2px solid var(--mg-busy);outline-offset:-2px}
#settingsPage.mg .pl-name{display:block;font:600 14px/1.4 var(--ui);color:var(--ink)}
#settingsPage.mg .pl-desc{display:block;margin-top:3px;font:12px/1.55 var(--ui);color:var(--grey);max-width:56ch}
#settingsPage.mg .pl-ms{display:flex;flex-direction:column;gap:6px;min-width:84px}
#settingsPage.mg .pl-ms b{font:600 12.5px var(--mg-mono);color:var(--ink)}
#settingsPage.mg .pl-bar{display:block;height:4px;border-radius:2px;background:color-mix(in srgb,var(--ink) 12%,transparent);overflow:hidden}
#settingsPage.mg .pl-bar i{display:block;height:100%;background:var(--mg-ok);border-radius:2px}
#settingsPage.mg .pl-next{color:var(--grey);max-width:24ch}
#settingsPage.mg .pl-tasks{display:inline-flex;flex-direction:column;align-items:flex-start;line-height:1.25}
#settingsPage.mg .pl-tasks b{font:600 15px var(--mg-mono);color:var(--mg-mute)}
#settingsPage.mg .pl-tasks span{font:10.5px var(--mg-mono);color:var(--grey)}
#settingsPage.mg .pl-tasks.on b{color:var(--mg-busy)}
#settingsPage.mg .pl-teams{display:flex;flex-wrap:wrap;gap:5px;max-width:22ch}
#settingsPage.mg .team-chip{display:inline-block;padding:2px 8px;border:1px solid color-mix(in srgb,var(--tc,#B9B7AE) 55%,transparent);border-radius:6px;background:color-mix(in srgb,var(--tc,#B9B7AE) 26%,transparent);font:600 9.5px var(--mg-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--ti,var(--grey));white-space:nowrap}
body.dark #settingsPage.mg .team-chip{background:color-mix(in srgb,var(--tc,#B9B7AE) 16%,transparent);color:var(--tc,var(--grey));border-color:color-mix(in srgb,var(--tc,#B9B7AE) 40%,transparent)}
#settingsPage.mg .pl-when b{display:block;font:600 12.5px var(--ui);color:var(--ink)}
#settingsPage.mg .pl-when span{font:10.5px var(--mg-mono);color:var(--mg-mute)}
#settingsPage.mg .pl-dash{color:var(--mg-mute)}
#settingsPage.mg .pl-none{padding:26px 18px;text-align:center;color:var(--grey)}
#settingsPage.mg .pl-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 18px;background:var(--mg-rail);border-top:1px solid var(--hairline);font:11px var(--mg-mono);color:var(--mg-mute)}
@media (max-width:1000px){#settingsPage.mg table.pl :is(th,td):nth-child(4),#settingsPage.mg table.pl :is(th,td):nth-child(6){display:none}}

/* ---- a project's Work: the figures, then the milestone tree, then the way in ---- */
#settingsPage.mg .pw{display:block}
#settingsPage.mg .pw-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin:0 0 16px}
#settingsPage.mg .pw-head h3{display:flex;align-items:center;gap:9px;margin:0;font:400 23px/1.2 var(--serif);color:var(--ink)}
#settingsPage.mg .pw-head h3 .pw-i{width:19px;height:19px;color:var(--mg-gold)}
#settingsPage.mg .pw-head p{margin:5px 0 0;font:12.5px/1.5 var(--ui);color:var(--grey);max-width:52ch;text-wrap:pretty}
#settingsPage.mg .pw-head-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
#settingsPage.mg .pw-head-actions .mg-btn .pw-i{width:13px;height:13px;margin-right:5px}
#settingsPage.mg .pw-seg{display:inline-flex;padding:3px;border:1px solid var(--hairline);border-radius:10px;background:var(--mg-card)}
#settingsPage.mg .pw-seg button{border:0;background:transparent;border-radius:7px;padding:5px 11px;font:500 11.5px var(--ui);color:var(--grey);cursor:pointer;height:auto}
#settingsPage.mg .pw-seg button[aria-pressed=true]{background:var(--ink);color:var(--cream)}
/* The figures */
#settingsPage.mg .pw-kpis{display:grid;grid-template-columns:minmax(280px,1fr) minmax(0,1.9fr);gap:12px;margin:0 0 16px}
#settingsPage.mg .pw-kpi{background:var(--mg-card);border:1px solid var(--hairline);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:12px}
#settingsPage.mg .pw-kpi-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
#settingsPage.mg .pw-big{font:400 46px/1 var(--serif);color:var(--ink);margin-top:8px}
#settingsPage.mg .pw-dial{width:68px;height:68px;flex:none}
#settingsPage.mg .pw-next{display:flex;flex-direction:column;gap:3px;padding:12px 0 0;border-top:1px solid var(--hairline)}
#settingsPage.mg .pw-next b{font:600 13px/1.4 var(--ui);color:var(--ink)}
#settingsPage.mg .pw-next-due{font:11px var(--mg-mono);color:var(--grey)}
#settingsPage.mg .pw-dial-bg{stroke:color-mix(in srgb,var(--ink) 10%,transparent)}
#settingsPage.mg .pw-dial-fg{stroke:var(--mg-gold)}
#settingsPage.mg .pw-kpi-foot{display:flex;flex-wrap:wrap;gap:6px 14px;padding-top:11px;border-top:1px solid var(--hairline);font:11.5px var(--ui);color:var(--grey);margin-top:auto}
#settingsPage.mg .pw-kpi-foot span{display:inline-flex;align-items:center;gap:6px}
#settingsPage.mg .pw-kpi-foot .pw-i{width:13px;height:13px;color:var(--mg-ok)}
#settingsPage.mg .pw-kpi-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
#settingsPage.mg .pw-kpi-note{font:11.5px var(--mg-mono);color:var(--grey)}
#settingsPage.mg .pw-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
#settingsPage.mg .pw-tile{border:1px solid var(--hairline);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
#settingsPage.mg .pw-tile span{font:500 11px var(--ui);color:var(--grey)}
#settingsPage.mg .pw-tile b{font:400 27px/1 var(--serif);color:var(--ink)}
#settingsPage.mg .pw-tile.ok{background:var(--mg-ok-bg);border-color:transparent}#settingsPage.mg .pw-tile.ok span{color:var(--mg-ok)}
#settingsPage.mg .pw-tile.busy{background:var(--mg-busy-bg);border-color:transparent}#settingsPage.mg .pw-tile.busy span{color:var(--mg-busy)}
#settingsPage.mg .pw-tile.fail{background:var(--mg-fail-bg);border-color:transparent}#settingsPage.mg .pw-tile.fail span{color:var(--mg-fail)}
#settingsPage.mg .pw-spread-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px;font:11.5px var(--ui);color:var(--grey)}
#settingsPage.mg .pw-spread-head em{font-style:normal;font-family:var(--mg-mono);font-size:11px;color:var(--mg-mute);text-align:right}
#settingsPage.mg .pw-spread-bar{display:flex;gap:2px;height:9px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--ink) 8%,transparent)}
#settingsPage.mg .pw-spread-bar i{display:block;height:100%}
#settingsPage.mg .pw-spread-bar .done{background:var(--mg-ok)}#settingsPage.mg .pw-spread-bar .going{background:var(--mg-busy)}
#settingsPage.mg .pw-spread-bar .you{background:var(--mg-warn)}#settingsPage.mg .pw-spread-bar .stuck{background:var(--mg-fail)}
#settingsPage.mg .pw-spread-bar .todo{background:color-mix(in srgb,var(--ink) 18%,transparent)}
/* The tree */
#settingsPage.mg .pw-table{background:var(--mg-card);border:1px solid var(--hairline);border-radius:14px;overflow-x:auto}
#settingsPage.mg .pw-row{display:grid;grid-template-columns:minmax(240px,1.7fr) minmax(92px,.6fr) minmax(124px,.9fr) 112px 118px 104px;align-items:center;gap:14px;padding:11px 18px}
#settingsPage.mg .pw-teamcol{display:flex;flex-wrap:wrap;gap:4px;min-width:0;font:600 10px var(--mg-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--grey)}
#settingsPage.mg .pw-teamcol .team-chip{font-size:9px;padding:1px 7px}
#settingsPage.mg .pw-who{font:11.5px/1.35 var(--ui);color:var(--ink);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
#settingsPage.mg .pw-headrow .pw-who,#settingsPage.mg .pw-headrow .pw-teamcol{font:600 10px var(--mg-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--grey);display:block}
#settingsPage.mg .pw-ms .pw-teamcol{align-items:center}
#settingsPage.mg .pw-none{color:var(--mg-mute)}
#settingsPage.mg .pw-ms .pw-teamcol{color:var(--ink)}
#settingsPage.mg .pw-step .pw-who{color:var(--grey);font-size:11px}
#settingsPage.mg :is(.pw-empty,.pw-addrow) .pw-name{grid-column:1 / -1}
#settingsPage.mg :is(.pw-empty,.pw-addrow,.pw-headrow){min-width:0}
#settingsPage.mg .pw-headrow{background:var(--mg-rail);border-bottom:1px solid var(--hairline);font:600 10px var(--mg-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--grey)}
#settingsPage.mg .pw-headrow .pw-name{display:flex;align-items:center;gap:8px}
#settingsPage.mg .pw-group{border-bottom:1px solid var(--hairline)}
#settingsPage.mg .pw-group:last-of-type{border-bottom:0}
#settingsPage.mg .pw-ms{background:color-mix(in srgb,var(--mg-rail) 60%,transparent);padding-top:13px;padding-bottom:13px}
#settingsPage.mg .pw-name{display:flex;align-items:center;gap:9px;min-width:0}
#settingsPage.mg .pw-title{display:flex;align-items:center;gap:9px;min-width:0;flex-wrap:wrap}
#settingsPage.mg .pw-ms b{font:600 13.5px/1.45 var(--ui);color:var(--ink)}
#settingsPage.mg .pw-kids{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border:1px solid var(--hairline);border-radius:99px;font:600 10.5px var(--mg-mono);color:var(--grey);background:var(--mg-card);white-space:nowrap}
#settingsPage.mg .pw-kids .pw-i{width:11px;height:11px}
#settingsPage.mg .pw-x{border:0;background:transparent;color:var(--grey);cursor:pointer;padding:2px;height:auto;display:inline-grid;place-items:center;flex:none}
#settingsPage.mg .pw-x .pw-i{width:14px;height:14px;transition:transform .16s ease}
#settingsPage.mg .pw-x[aria-expanded=false] .pw-i{transform:rotate(-90deg)}
#settingsPage.mg .pw-ring{width:15px;height:15px;border-radius:50%;border:2px solid var(--mg-mute);flex:none;display:inline-block;position:relative}
#settingsPage.mg .pw-ring::after{content:"";position:absolute;inset:3px;border-radius:50%;background:transparent}
#settingsPage.mg .pw-ring.ok{border-color:var(--mg-ok);background:var(--mg-ok-bg)}#settingsPage.mg .pw-ring.ok::after{background:var(--mg-ok)}
#settingsPage.mg .pw-ring.busy{border-color:var(--mg-busy)}#settingsPage.mg .pw-ring.busy::after{background:var(--mg-busy)}
#settingsPage.mg .pw-ring.warn{border-color:var(--mg-warn)}#settingsPage.mg .pw-ring.warn::after{background:var(--mg-warn)}
#settingsPage.mg .pw-ring.fail{border-color:var(--mg-fail)}#settingsPage.mg .pw-ring.fail::after{background:var(--mg-fail)}
#settingsPage.mg .pw-progress{display:flex;align-items:center;gap:9px;font:11.5px var(--ui);color:var(--grey)}
#settingsPage.mg .pw-bar{flex:1;min-width:0;height:7px;border-radius:99px;background:color-mix(in srgb,var(--ink) 10%,transparent);overflow:hidden}
#settingsPage.mg .pw-bar i{display:block;height:100%;background:var(--mg-mute);border-radius:99px;transition:width .5s ease}
#settingsPage.mg .pw-bar.ok i{background:var(--mg-ok)}#settingsPage.mg .pw-bar.busy i{background:var(--mg-busy)}
#settingsPage.mg .pw-bar.warn i{background:var(--mg-warn)}#settingsPage.mg .pw-bar.fail i{background:var(--mg-fail)}
#settingsPage.mg .pw-progress em{font-style:normal;font:600 11.5px var(--mg-mono);color:var(--ink);flex:none}
#settingsPage.mg .pw-progress-task{font:11.5px var(--mg-mono);color:var(--mg-mute)}
#settingsPage.mg .pw-progress-task.busy{color:var(--mg-busy)}#settingsPage.mg .pw-progress-task.warn{color:var(--mg-warn)}#settingsPage.mg .pw-progress-task.fail{color:var(--mg-fail)}
#settingsPage.mg .pw-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;border:1px solid transparent;font:600 11px var(--ui);white-space:nowrap}
#settingsPage.mg .pw-chip .pw-i{width:12px;height:12px}
#settingsPage.mg .pw-chip.ok{background:var(--mg-ok-bg);color:var(--mg-ok)}
#settingsPage.mg .pw-chip.busy{background:var(--mg-busy-bg);color:var(--mg-busy)}
#settingsPage.mg .pw-chip.warn{background:var(--mg-warn-bg);color:var(--mg-warn)}
#settingsPage.mg .pw-chip.fail{background:var(--mg-fail-bg);color:var(--mg-fail)}
#settingsPage.mg .pw-chip.off{background:var(--mg-hover);color:var(--grey);border-color:var(--hairline)}
#settingsPage.mg .pw-chip.gone{background:#FBEFE4;color:#C2691E}
body.dark #settingsPage.mg .pw-chip.gone{background:rgba(194,105,30,.16);color:#E8A166}
#settingsPage.mg .pw-ring.gone{border-color:#C2691E}#settingsPage.mg .pw-ring.gone::after{background:#C2691E}
#settingsPage.mg .pw-when{display:flex;flex-direction:column;align-items:flex-end;gap:1px;text-align:right}
#settingsPage.mg .pw-when b{font:500 11.5px var(--ui);color:var(--ink)}
#settingsPage.mg .pw-when span{font:10.5px var(--mg-mono);color:var(--mg-mute)}
#settingsPage.mg .pw-when .pw-due{font:9.5px var(--mg-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--mg-mute)}
#settingsPage.mg .pw-task{border-top:1px solid var(--hairline);cursor:pointer}
#settingsPage.mg .pw-task:hover{background:var(--mg-hover)}
#settingsPage.mg .pw-task:focus-visible{background:var(--mg-hover);outline:2px solid var(--mg-busy);outline-offset:-2px}
#settingsPage.mg .pw-tt{display:flex;flex-direction:column;gap:2px;min-width:0}
#settingsPage.mg .pw-tt{font:12.5px/1.45 var(--ui);color:var(--ink)}
#settingsPage.mg .pw-team{font:10.5px var(--mg-mono);letter-spacing:.06em;text-transform:uppercase;color:var(--mg-mute)}
#settingsPage.mg .pw-tree{width:22px;height:10px;margin-left:10px;border-left:1.5px solid color-mix(in srgb,var(--ink) 20%,transparent);border-bottom:1.5px solid color-mix(in srgb,var(--ink) 20%,transparent);border-bottom-left-radius:6px;flex:none}
#settingsPage.mg .pw-empty{border-top:1px solid var(--hairline);font:12px var(--ui);color:var(--grey)}
#settingsPage.mg .pw-nox{width:18px;flex:none}
#settingsPage.mg .pw-x-step{padding:2px;margin-right:-2px}
#settingsPage.mg .pw-x-step .pw-i{width:12px;height:12px}
#settingsPage.mg .pw-x-step[aria-expanded=true] .pw-i{transform:none}
#settingsPage.mg .pw-x-step[aria-expanded=false] .pw-i{transform:rotate(-90deg)}
#settingsPage.mg .pw-steps{background:color-mix(in srgb,var(--mg-rail) 45%,transparent)}
#settingsPage.mg .pw-step{border-top:1px solid var(--hairline);cursor:pointer;padding-top:8px;padding-bottom:8px}
#settingsPage.mg .pw-step:hover{background:var(--mg-hover)}
#settingsPage.mg .pw-step .pw-tt{font:12px/1.45 var(--ui);color:var(--grey)}
#settingsPage.mg .pw-step .pw-ring{width:11px;height:11px;border-width:1.5px}
#settingsPage.mg .pw-step .pw-chip{font-size:10px;padding:2px 8px}
#settingsPage.mg .pw-tree-2{margin-left:36px;width:18px}
#settingsPage.mg .pw-addrow{border-top:1px solid var(--hairline);padding-top:8px;padding-bottom:10px}
#settingsPage.mg .pw-add,#settingsPage.mg .pw-link{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--grey);font:500 11.5px var(--ui);cursor:pointer;padding:2px 0;height:auto}
#settingsPage.mg .pw-add{margin-left:34px}
#settingsPage.mg .pw-add:hover,#settingsPage.mg .pw-link:hover{color:var(--ink)}
#settingsPage.mg .pw-add .pw-i,#settingsPage.mg .pw-link .pw-i{width:12px;height:12px}
#settingsPage.mg .pw-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:12px 18px;background:var(--mg-rail);border-top:1px solid var(--hairline)}
#settingsPage.mg .pw-foot-actions{display:flex;align-items:center;gap:12px}
#settingsPage.mg .pw-sep{width:1px;height:14px;background:var(--hairline)}
#settingsPage.mg .pw-keys{display:flex;gap:14px;font:11px var(--ui);color:var(--mg-mute)}
#settingsPage.mg .pw-keys span{display:inline-flex;align-items:center;gap:6px}
#settingsPage.mg .pw-keys kbd{border:1px solid var(--hairline);border-radius:5px;padding:1px 6px;background:var(--mg-card);font:10.5px var(--mg-mono);color:var(--grey)}
#settingsPage.mg .pw-i{display:inline-block;vertical-align:middle;flex:none}
@keyframes pwSpin{to{transform:rotate(360deg)}}
#settingsPage.mg .pw-spin{animation:pwSpin 1.1s linear infinite;transform-origin:50% 50%}
@media (prefers-reduced-motion:reduce){#settingsPage.mg .pw-spin{animation:none}}
@media (max-width:960px){#settingsPage.mg .pw-kpis{grid-template-columns:minmax(0,1fr)}}
@media (max-width:1180px){#settingsPage.mg .pw-row{grid-template-columns:minmax(220px,1.7fr) minmax(88px,.6fr) minmax(120px,.9fr) 108px 114px}#settingsPage.mg .pw-when{display:none}}
@media (max-width:980px){#settingsPage.mg .pw-row{grid-template-columns:minmax(220px,1fr) minmax(120px,.9fr) 114px}#settingsPage.mg .pw-teamcol,#settingsPage.mg .pw-progress{display:none}}
@media (max-width:860px){#settingsPage.mg .pw-kpis{grid-template-columns:minmax(0,1fr)}#settingsPage.mg .pw-row{grid-template-columns:minmax(0,1fr) 118px;row-gap:6px}#settingsPage.mg .pw-who{display:none}}
/* Adding a task: one dialog, the milestone chosen from the ones the project has. */
#settingsPage.mg .pw-modal{width:min(680px,100%);max-height:88vh;display:flex;flex-direction:column}
#settingsPage.mg .pw-form{overflow:auto;padding:20px 22px 0}
#settingsPage.mg .pw-field{margin:16px 0 0}
#settingsPage.mg .pw-picks{display:grid;gap:8px;margin-top:8px;max-height:246px;overflow:auto}
#settingsPage.mg .pw-pick,#settingsPage.mg .pw-prio{display:flex;align-items:flex-start;gap:10px;padding:10px 13px;border:1px solid var(--hairline);border-radius:10px;cursor:pointer}
#settingsPage.mg .pw-pick:hover,#settingsPage.mg .pw-prio:hover{border-color:var(--mg-line2)}
#settingsPage.mg .pw-pick:has(input:checked),#settingsPage.mg .pw-prio:has(input:checked){border-color:var(--ink);background:var(--mg-hover)}
#settingsPage.mg .pw-pick input,#settingsPage.mg .pw-prio input{margin:2px 0 0;width:auto;flex:none;accent-color:var(--ink)}
#settingsPage.mg .pw-pick>span,#settingsPage.mg .pw-prio>span{flex:1;min-width:0}
#settingsPage.mg .pw-pick b,#settingsPage.mg .pw-prio b{display:block;font:600 12.5px/1.4 var(--ui);color:var(--ink)}
#settingsPage.mg .pw-pick small,#settingsPage.mg .pw-prio small{display:block;margin-top:2px;font:11.5px/1.4 var(--mg-mono);color:var(--grey)}
#settingsPage.mg .pw-prios{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}
#settingsPage.mg .pw-form .mg-savebar{position:sticky;bottom:0;margin:18px -22px 0;border-radius:0}
@media (max-width:640px){#settingsPage.mg .pw-prios{grid-template-columns:1fr}}

/* ---- a project's Results: the address the CEO opens is the hero, then the summary as a document, then what it is made of ---- */
#settingsPage.mg .mg-result-head{display:flex;flex-direction:column;gap:8px;margin:0 0 20px}
#settingsPage.mg .mg-result-head h2{margin:0;font:400 27px/1.25 var(--serif);color:var(--ink);letter-spacing:.01em;max-width:32ch}
#settingsPage.mg .mg-result-meta{font:500 11px/1.4 var(--mg-mono);letter-spacing:.04em;text-transform:uppercase;color:var(--mg-mute)}
/* The plates: what was built, ready to open. The first is the one the CEO wants. */
#settingsPage.mg .mg-opens{display:grid;gap:10px;margin:0 0 22px}
#settingsPage.mg .mg-open{display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:16px;padding:15px 18px;border:1px solid var(--hairline);border-radius:14px;background:var(--mg-card);color:var(--ink);text-decoration:none;transition:transform .14s var(--ease,ease),border-color .14s,box-shadow .14s}
#settingsPage.mg .mg-open:hover{transform:translateY(-1px);border-color:var(--mg-gold);box-shadow:var(--mg-shadow)}
#settingsPage.mg .mg-open-go{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--mg-hover);color:var(--ink);font:16px/1 var(--ui)}
#settingsPage.mg .mg-open-text{display:flex;flex-direction:column;gap:3px;min-width:0}
#settingsPage.mg .mg-open-text b{font:600 14.5px/1.3 var(--ui);letter-spacing:.005em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#settingsPage.mg .mg-open-host{font:11.5px/1.3 var(--mg-mono);color:var(--grey);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#settingsPage.mg .mg-open-cta{font:600 10.5px/1 var(--mg-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--grey);white-space:nowrap}
#settingsPage.mg .mg-open.primary{background:var(--mg-card);border-color:var(--mg-gold);box-shadow:inset 3px 0 0 var(--mg-gold)}
#settingsPage.mg .mg-open.primary .mg-open-go{background:var(--mg-gold);color:#1B1A18}
#settingsPage.mg .mg-open.primary:hover{box-shadow:inset 3px 0 0 var(--mg-gold),var(--mg-shadow)}
#settingsPage.mg .mg-open.primary .mg-open-cta{color:var(--ink)}
#settingsPage.mg .mg-open.primary:hover{border-color:var(--mg-gold)}
/* The summary: a document that uses the width it has. */
#settingsPage.mg .mg-doc.mg-summary{max-width:none;padding:34px 40px;font:14.5px/1.75 var(--ui);color:var(--ink)}
#settingsPage.mg .mg-summary :is(p,li){font:inherit;overflow-wrap:anywhere}
#settingsPage.mg .mg-summary p{margin:0 0 1.05em}
#settingsPage.mg .mg-summary :is(h1,h2,h3){color:var(--ink);font-family:var(--serif);font-weight:400;line-height:1.25;letter-spacing:.01em}
#settingsPage.mg .mg-summary h1{font-size:25px;margin:32px 0 12px}
#settingsPage.mg .mg-summary h2{font-size:22px;margin:30px 0 11px}
#settingsPage.mg .mg-summary h3{font-size:18px;margin:26px 0 9px}
#settingsPage.mg .mg-summary>:first-child{margin-top:0}
#settingsPage.mg .mg-summary ul{margin:0 0 1.05em;padding-left:0;list-style:none}
#settingsPage.mg .mg-summary ul li{position:relative;padding:0 0 0 22px;margin:0 0 .85em}
#settingsPage.mg .mg-summary ul li::before{content:"";position:absolute;left:4px;top:.72em;width:7px;height:7px;border-radius:2px;background:var(--mg-gold)}
#settingsPage.mg .mg-summary ol{margin:0 0 1.05em;padding-left:22px}
/* A bullet that opens with its own name reads as a title for what follows. */
#settingsPage.mg .mg-summary li>strong:first-child,#settingsPage.mg .mg-summary li>p:first-child>strong:first-child{display:block;font:400 17px/1.35 var(--serif);letter-spacing:.01em;color:var(--ink);margin:0 0 3px}
#settingsPage.mg .mg-summary strong{font-weight:600}
#settingsPage.mg .mg-summary a{font-weight:600;color:var(--ink);text-decoration:underline;text-decoration-color:var(--mg-gold);text-decoration-thickness:2px;text-underline-offset:3px}
#settingsPage.mg .mg-summary a:hover{background:var(--mg-hover);text-decoration-color:var(--ink)}
#settingsPage.mg .mg-summary code{font:13px var(--mg-mono);background:var(--mg-hover);border-radius:5px;padding:1px 5px}
#settingsPage.mg .mg-summary em{font-style:italic;color:var(--grey)}
/* A file named in the prose is the file: its tile, its name, and it downloads. */
#settingsPage.mg .mg-filelink{display:inline-flex;align-items:center;gap:6px;vertical-align:baseline;padding:1px 7px 1px 4px;border:1px solid var(--hairline);border-radius:7px;background:var(--mg-card);font:600 12.5px var(--mg-mono);color:var(--ink);text-decoration:none}
#settingsPage.mg .mg-filelink:hover{border-color:var(--mg-gold);background:var(--mg-hover)}
#settingsPage.mg button.mg-filelink{cursor:pointer;font:600 12.5px var(--mg-mono)}
#settingsPage.mg .mg-fileset{display:inline-flex;align-items:stretch;gap:0;vertical-align:baseline}
#settingsPage.mg .mg-fileset .mg-filelink{border-top-right-radius:0;border-bottom-right-radius:0}
#settingsPage.mg .mg-filedl{display:inline-flex;align-items:center;padding:1px 8px;margin-left:-1px;border:1px solid var(--hairline);border-top-right-radius:7px;border-bottom-right-radius:7px;background:var(--mg-card);font:600 12.5px var(--mg-mono);color:var(--grey);text-decoration:none}
#settingsPage.mg .mg-filedl:hover{border-color:var(--mg-gold);background:var(--mg-hover);color:var(--ink)}
#settingsPage.mg .mg-filelink .file-icon{margin-right:0;vertical-align:-8px}
#settingsPage.mg .mg-urllink{font:600 13px var(--mg-mono);color:var(--ink);text-decoration:underline;text-decoration-color:var(--mg-gold);text-decoration-thickness:2px;text-underline-offset:3px;overflow-wrap:anywhere}
#settingsPage.mg .mg-urllink:hover{background:var(--mg-hover)}
/* What was delivered: one row per thing, its name as a title, and the file or address it is. */
#settingsPage.mg .mg-deliv{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 24px;align-items:start;padding:14px 0;border-top:1px solid var(--hairline)}
#settingsPage.mg .mg-deliv:first-of-type{border-top:0}
#settingsPage.mg .mg-deliv b{display:block;font:400 18px/1.3 var(--serif);letter-spacing:.01em;color:var(--ink)}
#settingsPage.mg .mg-deliv span{display:block;margin-top:3px;font:13px/1.55 var(--ui);color:var(--grey)}
#settingsPage.mg .mg-deliv-where{text-align:right;white-space:nowrap}
#settingsPage.mg .mg-note-list{margin:0;padding:0;list-style:none;display:grid;gap:9px}
#settingsPage.mg .mg-note-list li{position:relative;padding-left:16px;font:13.5px/1.6 var(--ui);color:var(--ink)}
#settingsPage.mg .mg-note-list li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;border-radius:50%;background:var(--mg-gold)}
#settingsPage.mg .mg-results-section{margin-top:26px}
@media (max-width:820px){#settingsPage.mg .mg-deliv{grid-template-columns:minmax(0,1fr)}#settingsPage.mg .mg-deliv-where{text-align:left}#settingsPage.mg .mg-doc.mg-summary{padding:24px 20px}#settingsPage.mg .mg-open{grid-template-columns:32px minmax(0,1fr)}#settingsPage.mg .mg-open-cta{display:none}}
#settingsPage.mg .mg-snippet{color:var(--grey);font:12px/1.5 var(--ui);margin-top:4px;display:block}
@media (max-width:900px){#settingsPage.mg .mg-brain{grid-template-columns:1fr}#settingsPage.mg .mg-folders{flex-direction:row;flex-wrap:wrap;position:static}#settingsPage.mg .mg-folders button{width:auto}}

/* ---- the task view (in the task dialog): the decision first, then the four tabs ---- */
#spaceDialog[data-view=task]>header{padding:0;height:0;overflow:visible}
#spaceDialog[data-view=task] #spaceTitle{display:none}
#spaceDialog[data-view=task] #spaceClose{position:absolute;top:12px;right:16px;z-index:4;width:32px;height:32px;border-radius:50%;font-size:22px;line-height:1;display:grid;place-items:center;color:var(--grey)}
#spaceDialog[data-view=task] #spaceClose:hover{background:var(--mg-hover);color:var(--ink)}
#spaceDialog #spaceExpand{display:none}
#spaceDialog[data-view=task] #spaceExpand{display:grid;place-items:center;position:absolute;top:12px;right:52px;z-index:4;width:32px;height:32px;border-radius:50%;border:0;background:transparent;color:var(--grey);font:16px/1 var(--ui);cursor:pointer;padding:0}
#spaceDialog[data-view=task] #spaceExpand:hover{background:var(--mg-hover);color:var(--ink)}
#spaceDialog[data-view=task] .space-audience{margin-right:84px}
#spaceDialog[data-view=task] .tv-top{padding-right:84px}
#spaceDialog[data-view=task] #spaceContent>:first-child:not(.space-audience):not(.tv-head){padding-right:84px}
#spaceDialog[data-view=task].full[open]{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;margin:0;border-radius:0;border:0;padding:24px clamp(24px,5vw,72px) 0}
#spaceDialog[data-view=task].full .tv-doc{max-width:min(100%,116ch);margin-inline:auto}
#spaceDialog[data-view=task].full .tv-two{grid-template-columns:minmax(0,1fr) clamp(260px,22vw,360px);gap:clamp(36px,4vw,64px)}
#spaceDialog[data-view=task] #spaceContent{padding:2px 8px 28px 0;font:13px/1.5 var(--ui);scrollbar-width:none;scrollbar-gutter:auto}
#spaceDialog[data-view=task] #spaceContent::-webkit-scrollbar{display:none}
#spaceDialog[data-view=task]{scrollbar-width:none}#spaceDialog[data-view=task]::-webkit-scrollbar{display:none}
#spaceDialog[data-view=task] .tv-head{padding:2px 36px 0 0}
#spaceDialog[data-view=task] .tv-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
#spaceDialog[data-view=task] .tv-title{margin:8px 0 6px;font:400 28px/1.15 var(--serif);letter-spacing:0;max-width:820px}
#spaceDialog[data-view=task] .tv-chip{display:inline-block;padding:2px 8px;border:1px solid var(--hairline);border-radius:99px;font:500 10.5px var(--mg-mono);letter-spacing:.04em;color:var(--grey)}
#spaceDialog[data-view=task] .tv-facts{display:flex;flex-wrap:wrap;gap:6px 18px;font:11.5px var(--mg-mono);color:var(--grey);padding:2px 0 16px}
#spaceDialog[data-view=task] .tv-facts b{font-weight:500;color:var(--ink)}
#spaceDialog[data-view=task] .tv-decision{border:1px solid;border-radius:12px;padding:14px 18px;margin:0 0 16px;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;align-items:start}
#spaceDialog[data-view=task] .tv-fail{border-color:color-mix(in srgb,var(--mg-fail) 40%,transparent);background:var(--mg-fail-bg)}
#spaceDialog[data-view=task] .tv-warn{border-color:color-mix(in srgb,var(--mg-warn) 45%,transparent);background:var(--mg-warn-bg)}
#spaceDialog[data-view=task] .tv-ok{border-color:color-mix(in srgb,var(--mg-ok) 35%,transparent);background:var(--mg-ok-bg)}
#spaceDialog[data-view=task] .tv-busy{border-color:color-mix(in srgb,var(--mg-busy) 35%,transparent);background:var(--mg-busy-bg)}
#spaceDialog[data-view=task] .tv-off{border-color:var(--hairline);background:var(--mg-rail)}
#spaceDialog[data-view=task] .tv-glyph{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font:700 11px var(--mg-mono);color:#fff;background:var(--mg-mute);margin-top:1px}
#spaceDialog[data-view=task] .tv-fail .tv-glyph{background:var(--mg-fail)}#spaceDialog[data-view=task] .tv-warn .tv-glyph{background:var(--mg-warn)}#spaceDialog[data-view=task] .tv-ok .tv-glyph{background:var(--mg-ok)}#spaceDialog[data-view=task] .tv-busy .tv-glyph{background:var(--mg-busy)}
#spaceDialog[data-view=task] .tv-dtext b{display:block;font:600 13.5px/1.4 var(--ui);color:var(--ink)}
#spaceDialog[data-view=task] .tv-dtext p{margin:3px 0 0;font:12.5px/1.5 var(--ui);color:var(--ink)}
#spaceDialog[data-view=task] .tv-raw{margin:8px 0 0}
#spaceDialog[data-view=task] .tv-raw>summary{font:500 11px var(--mg-mono);color:var(--grey);cursor:pointer;list-style:none}
#spaceDialog[data-view=task] .tv-raw>summary::-webkit-details-marker{display:none}
#spaceDialog[data-view=task] .tv-raw pre{margin:6px 0 0;padding:10px 12px;border-radius:8px;border:0;max-height:220px;overflow:auto;background:color-mix(in srgb,var(--ink) 6%,transparent);font:11px/1.55 var(--mg-mono);white-space:pre-wrap;color:var(--grey)}
#spaceDialog[data-view=task] .tv-dact{grid-column:2;margin-top:8px}
#spaceDialog[data-view=task] .tv-field{display:block;margin:6px 0 0;font:500 12px var(--ui);color:var(--ink)}
#spaceDialog[data-view=task] .tv-field textarea,#spaceDialog[data-view=task] .tv-field select{display:block;width:100%;margin:6px 0 0;border:1px solid var(--mg-line2);border-radius:8px;padding:9px 11px;background:var(--mg-card);color:var(--ink);font:13px/1.5 var(--ui)}
#spaceDialog[data-view=task] .tv-field textarea{min-height:60px;resize:vertical}
#spaceDialog[data-view=task] .tv-field textarea:focus{outline:0;border-color:var(--mg-busy);box-shadow:0 0 0 3px var(--mg-busy-bg)}
#spaceDialog[data-view=task] .tv-act{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
#spaceDialog[data-view=task] .tv-sp{flex:1}
#spaceDialog[data-view=task] .tv-inline{display:inline-flex;align-items:center;gap:8px;font:12px var(--ui);color:var(--grey)}
#spaceDialog[data-view=task] .tv-inline select{width:auto;margin:0;padding:6px 8px;border:1px solid var(--mg-line2);border-radius:6px;background:var(--mg-card);color:var(--ink);font:12px var(--ui)}
#spaceDialog[data-view=task] .tv-remember{display:inline-flex;align-items:center;gap:8px;font:12px var(--ui);color:var(--grey)}
#spaceDialog[data-view=task] .tv-remember input{width:16px;height:16px;accent-color:var(--mg-ok);margin:0}
#spaceDialog[data-view=task] .tv-more{margin:10px 0 0;border:0;padding:0;background:transparent}
#spaceDialog[data-view=task] .tv-more>summary{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--ink);background:var(--mg-card);font:500 12.5px var(--ui);color:var(--ink);cursor:pointer;list-style:none;text-decoration:none}
#spaceDialog[data-view=task] .tv-more>summary::after{content:"";width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-2px);transition:transform .15s}
#spaceDialog[data-view=task] .tv-more>summary:hover{background:var(--ink);color:var(--cream)}
#spaceDialog[data-view=task] .tv-more[open]>summary{background:var(--ink);color:var(--cream)}
#spaceDialog[data-view=task] .tv-more[open]>summary::after{transform:rotate(-135deg) translateY(-2px)}
#spaceDialog[data-view=task] .tv-more>.tv-field,#spaceDialog[data-view=task] .tv-more>.tv-act{margin-left:0}
#spaceDialog[data-view=task] .tv-more>summary::-webkit-details-marker{display:none}
#spaceDialog[data-view=task] .tv-pending{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
#spaceDialog[data-view=task] .tv-pend{border:1px solid var(--hairline);border-radius:8px;padding:8px 10px;background:var(--mg-card);font-size:12px}
#spaceDialog[data-view=task] .tv-pend pre{margin:6px 0 0;font:11px/1.5 var(--mg-mono);white-space:pre-wrap;border:0;padding:0;max-height:160px;background:transparent;color:var(--grey)}
#spaceDialog[data-view=task] .tv-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--mg-line2);background:transparent;font:500 12.5px var(--ui);color:var(--ink);white-space:nowrap;cursor:pointer;letter-spacing:0;text-decoration:none}
#spaceDialog[data-view=task] .tv-btn:hover{background:var(--mg-hover)}
#spaceDialog[data-view=task] .tv-btn-p{background:var(--ink);color:var(--cream);border-color:var(--ink)}#spaceDialog[data-view=task] .tv-btn-p:hover{background:color-mix(in srgb,var(--ink) 86%,var(--cream))}
#spaceDialog[data-view=task] .tv-btn-sm{height:28px;padding:0 10px;font-size:11.5px;border-radius:6px}
#spaceDialog[data-view=task] .tv-btn-text{border-color:transparent;color:var(--grey);padding:0 8px}#spaceDialog[data-view=task] .tv-btn-text:hover{color:var(--ink)}
#spaceDialog[data-view=task] .tv-danger{color:var(--mg-fail)}
#spaceDialog[data-view=task] .tv-btn:disabled{opacity:.5;cursor:default}
#spaceDialog[data-view=task] .tv-tabs{position:sticky;top:0;z-index:2;display:flex;gap:2px;border-bottom:1px solid var(--hairline);margin:0 0 18px;background:var(--cream)}
#spaceDialog[data-view=task] .tv-tabs button{background:transparent;color:var(--grey);border:0;border-bottom:2px solid transparent;margin-bottom:-1px;padding:11px 12px;font:500 13px var(--ui);border-radius:0;letter-spacing:0;display:inline-flex;align-items:center;gap:8px}
#spaceDialog[data-view=task] .tv-tabs button:hover{color:var(--ink)}
#spaceDialog[data-view=task] .tv-tabs button[aria-selected=true]{color:var(--ink);border-bottom-color:var(--ink)}
#spaceDialog[data-view=task] .tv-c{font:11px var(--mg-mono);color:var(--mg-mute)}
#spaceDialog[data-view=task] .tv-pane{outline:0}
#spaceDialog[data-view=task] .tv-two{display:grid;grid-template-columns:minmax(0,1fr) 224px;gap:26px;align-items:start}
#spaceDialog[data-view=task] .tv-toolbar{display:flex;align-items:center;gap:8px;margin:0 0 12px;flex-wrap:wrap}
#spaceDialog[data-view=task] .tv-outline{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px}
#spaceDialog[data-view=task] .tv-outline a{font:11.5px var(--ui);color:var(--grey);text-decoration:none;border:1px solid var(--hairline);border-radius:99px;padding:3px 10px}
#spaceDialog[data-view=task] .tv-outline a:hover{color:var(--ink);border-color:var(--mg-line2)}
#spaceDialog[data-view=task] .tv-doc{max-width:70ch;padding:0}
#spaceDialog[data-view=task] .tv-prov{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--hairline);margin-top:18px;padding-top:10px;font:11px var(--mg-mono);color:var(--grey)}
#spaceDialog[data-view=task] .tv-rail{display:flex;flex-direction:column;gap:16px;font:12px/1.5 var(--ui);position:sticky;top:48px;border-left:1px solid var(--hairline);padding-left:18px}
#spaceDialog[data-view=task] .tv-lab{font:500 10px var(--mg-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--grey);margin:0 0 6px}
#spaceDialog[data-view=task] .tv-row{display:flex;align-items:flex-start;gap:8px;margin:4px 0}
#spaceDialog[data-view=task] .tv-row small{display:block;font:10.5px var(--mg-mono);color:var(--grey)}
#spaceDialog[data-view=task] .tv-avatar{width:24px;height:24px;border-radius:50%;display:inline-grid;place-items:center;background:var(--mg-rail);border:1px solid var(--hairline);font:600 8.5px var(--mg-mono);letter-spacing:.04em;color:var(--grey);flex:none}
#spaceDialog[data-view=task] .tv-avatar.lead{border-color:var(--mg-gold);color:var(--mg-gold)}
#spaceDialog[data-view=task] .tv-tick{width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;font:700 10px var(--mg-mono);color:#fff;flex:none}
#spaceDialog[data-view=task] .tv-tick.pass{background:var(--mg-ok)}#spaceDialog[data-view=task] .tv-tick.fail{background:var(--mg-fail)}
#spaceDialog[data-view=task] .tv-note{border-left:2px solid var(--mg-gold);padding:2px 0 2px 12px;font:italic 13px/1.5 var(--serif);color:var(--ink)}
#spaceDialog[data-view=task] .tv-stats{font:11px/1.7 var(--mg-mono);color:var(--grey);border-top:1px solid var(--hairline);padding-top:10px}
#spaceDialog[data-view=task] .tv-stats:empty{display:none}
#spaceDialog[data-view=task] .tv-stop{border:1px dashed var(--mg-line2);border-radius:12px;padding:18px 20px;color:var(--grey);font-size:12.5px}
#spaceDialog[data-view=task] .tv-stop b{display:block;font:400 20px var(--serif);color:var(--ink);margin-bottom:6px}
#spaceDialog[data-view=task] .tv-card{background:var(--mg-card);border:1px solid var(--hairline);border-radius:12px;padding:18px 20px;margin:0 0 12px}
#spaceDialog[data-view=task] .tv-card h3{margin:0 0 4px;font:400 20px var(--serif);letter-spacing:0;text-transform:none}
#spaceDialog[data-view=task] .tv-plan-text{margin:0 0 10px;font:12.5px/1.5 var(--ui);color:var(--grey)}
#spaceDialog[data-view=task] .tv-plan{display:flex;align-items:center;gap:12px;margin:0 0 14px;font:12.5px var(--ui);color:var(--grey)}
#spaceDialog[data-view=task] .tv-bar{flex:1;height:4px;border-radius:2px;background:var(--hairline);overflow:hidden}#spaceDialog[data-view=task] .tv-bar i{display:block;height:100%;background:var(--mg-ok)}
#spaceDialog[data-view=task] .tv-todos ul{margin:4px 0 12px;padding-left:18px;font-size:12.5px}#spaceDialog[data-view=task] .tv-todos li.completed{color:var(--grey);text-decoration:line-through}
#spaceDialog[data-view=task] .tv-steps{display:flex;flex-direction:column;gap:8px}
#spaceDialog[data-view=task] .tv-step{border:1px solid var(--hairline);border-radius:10px;background:var(--mg-card);padding:0;margin:0}
#spaceDialog[data-view=task] .tv-step>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:26px 24px 1fr auto;gap:10px;align-items:center;padding:10px 14px;font:500 13px var(--ui)}
#spaceDialog[data-view=task] .tv-step>summary::-webkit-details-marker{display:none}#spaceDialog[data-view=task] .tv-step>summary::after{content:none}
#spaceDialog[data-view=task] .tv-n{font:500 11px var(--mg-mono);color:var(--mg-mute)}
#spaceDialog[data-view=task] .tv-t{font:500 13px var(--ui);min-width:0}#spaceDialog[data-view=task] .tv-t small{display:block;font:11px var(--mg-mono);color:var(--grey);margin-top:1px}
#spaceDialog[data-view=task] .tv-step[open]>summary{border-bottom:1px solid var(--hairline)}
#spaceDialog[data-view=task] .tv-step .tv-in{padding:12px 14px 14px 74px;font-size:12.5px}
#spaceDialog[data-view=task] .tv-instr{margin:0 0 8px;color:var(--ink)}
#spaceDialog[data-view=task] .tv-meta{font:11px var(--mg-mono);color:var(--grey);margin:6px 0}
#spaceDialog[data-view=task] .tv-accept{margin:2px 0 10px;padding-left:18px}#spaceDialog[data-view=task] .tv-accept li{margin:3px 0}
#spaceDialog[data-view=task] .tv-excerpt{border-left:2px solid var(--hairline);padding:2px 0 2px 12px;margin:4px 0 8px}
#spaceDialog[data-view=task] .tv-excerpt .space-document{font-size:12.5px;color:var(--grey)}
#spaceDialog[data-view=task] .tv-err{color:var(--mg-fail);font-size:12px}
#spaceDialog[data-view=task] .tv-sub{border:0;padding:0;margin:6px 0 0}#spaceDialog[data-view=task] .tv-sub>summary{font:500 11px var(--mg-mono);color:var(--grey);cursor:pointer}
#spaceDialog[data-view=task] .tv-fold{border:1px solid var(--hairline);border-radius:10px;background:var(--mg-card);margin:0 0 10px;padding:0}
#spaceDialog[data-view=task] .tv-fold>summary{cursor:pointer;padding:11px 16px;font:500 13px var(--ui);list-style:none;display:flex;align-items:center;gap:10px}
#spaceDialog[data-view=task] .tv-fold>summary::-webkit-details-marker{display:none}
#spaceDialog[data-view=task] .tv-fold>summary small{font:11px var(--mg-mono);color:var(--grey);font-weight:400}
#spaceDialog[data-view=task] .tv-fold[open]>summary{border-bottom:1px solid var(--hairline)}
#spaceDialog[data-view=task] .tv-fold>.tv-in{padding:14px 16px}
#spaceDialog[data-view=task] .tv-timeline{list-style:none;margin:0;padding:0}
#spaceDialog[data-view=task] .tv-timeline li{display:grid;grid-template-columns:118px 1fr;gap:12px;padding:6px 0;border-bottom:1px solid var(--hairline);font-size:12px}
#spaceDialog[data-view=task] .tv-timeline li:last-child{border:0}#spaceDialog[data-view=task] .tv-timeline time{font:11px var(--mg-mono);color:var(--grey)}#spaceDialog[data-view=task] .tv-timeline b{font-weight:600;margin-right:6px}
#spaceDialog[data-view=task] .tv-checks{margin-top:12px}
#spaceDialog[data-view=task] .tv-check{display:grid;grid-template-columns:20px 1fr;gap:4px 10px;padding:9px 0;border-bottom:1px solid var(--hairline)}
#spaceDialog[data-view=task] .tv-check:last-child{border:0}#spaceDialog[data-view=task] .tv-check b{font:600 12.5px var(--ui)}#spaceDialog[data-view=task] .tv-check p{grid-column:2;margin:0;font:12px/1.5 var(--ui);color:var(--grey)}
#spaceDialog[data-view=task] .tv-ledger{width:100%;border-collapse:collapse;border:1px solid var(--hairline);border-radius:10px;overflow:hidden;background:var(--mg-card)}
#spaceDialog[data-view=task] .tv-ledger th{font:500 10.5px var(--mg-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--grey);text-align:left;padding:9px 12px;border-bottom:1px solid var(--hairline);background:var(--mg-rail)}
#spaceDialog[data-view=task] .tv-ledger td{padding:10px 12px;border-bottom:1px solid var(--hairline);vertical-align:middle;font-size:12.5px}
#spaceDialog[data-view=task] .tv-ledger tr:last-child td{border-bottom:0}#spaceDialog[data-view=task] .tv-ledger td.k{font-family:var(--mg-mono);font-size:11.5px;white-space:nowrap;color:var(--grey)}#spaceDialog[data-view=task] .tv-ledger td.r{text-align:right;white-space:nowrap}
#spaceDialog[data-view=task] .tv-ledger td .file-icon{margin-right:8px;vertical-align:middle}
#spaceDialog[data-view=task] .tv-ledger td.r>*+*{margin-left:8px}
#spaceDialog[data-view=task] .tv-sub2{display:block;font:11px var(--mg-mono);color:var(--grey);margin:2px 0 0 42px}
@media (max-width:760px){#spaceDialog[data-view=task] .tv-two{grid-template-columns:1fr}#spaceDialog[data-view=task] .tv-rail{position:static;border:0;padding:0}#spaceDialog[data-view=task] .tv-title{font-size:23px}#spaceDialog[data-view=task] .tv-step .tv-in{padding-left:14px}}

/* toasts */
.toast-host{position:fixed;z-index:9999;right:16px;top:60px;left:auto;bottom:auto;transform:none;display:flex;flex-direction:column;gap:10px;width:min(380px,calc(100vw - 32px));pointer-events:none}
.toast{pointer-events:auto;display:grid;grid-template-columns:auto 1fr auto;gap:4px 12px;align-items:start;max-width:100%;padding:12px 12px 12px 14px;border-radius:12px;border:1px solid var(--hairline);border-left-width:3px;background:var(--mg-card);color:var(--ink);box-shadow:var(--mg-shadow);font:12.5px/1.45 var(--ui);opacity:0;transform:translateY(-6px);transition:opacity .18s,transform .18s}
.toast.in{opacity:1;transform:none}
.toast-mark{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font:700 11px var(--mg-mono);color:#fff;margin-top:1px;background:var(--mg-ok)}
.toast-text{font-weight:600}
.toast-detail{grid-column:2;color:var(--grey);font-size:12px}
.toast-x{grid-column:3;grid-row:1;border:0;background:transparent;color:var(--mg-mute);font-size:16px;line-height:1;padding:0 2px;cursor:pointer}
.toast-act{grid-column:2;margin-top:6px}
.toast-act button{height:28px;padding:0 10px;border-radius:6px;border:1px solid var(--mg-line2);background:transparent;color:var(--ink);font:500 11.5px var(--ui);cursor:pointer}
.toast-act button:hover{background:var(--mg-hover)}
.toast-ok{border-left-color:var(--mg-ok)} .toast-ok .toast-mark{background:var(--mg-ok)}
.toast-error{border-left-color:var(--mg-fail);background:var(--mg-card);color:var(--ink)} .toast-error .toast-mark{background:var(--mg-fail)}
.toast-warn{border-left-color:var(--mg-warn)} .toast-warn .toast-mark{background:var(--mg-warn)}
.toast-info{border-left-color:var(--mg-busy)} .toast-info .toast-mark{background:var(--mg-busy)}

/* small screens */
@media (max-width:900px){
  #settingsPage.mg{grid-template-columns:1fr;grid-template-rows:auto 1fr}
  #settingsPage.mg .mg-rail{display:flex;flex-wrap:nowrap;overflow:auto;gap:4px;padding:8px 12px;border-right:0;border-bottom:1px solid var(--hairline)}
  #settingsPage.mg .mg-rail .mg-eyebrow,#settingsPage.mg .mg-rail-office,#settingsPage.mg .mg-back{display:none}
  #settingsPage.mg .mg-rail a[data-section]{padding:6px 10px;border:1px solid var(--hairline);border-radius:99px;font-size:12px;white-space:nowrap;flex:none}
  #settingsPage.mg .mg-rail a[data-section] .mg-meta{margin-left:4px}
  #settingsPage.mg .settings-main{padding:18px 14px 100px}
  #settingsPage.mg .mg-area-head{grid-template-columns:1fr}#settingsPage.mg .mg-area-meta{align-items:flex-start}
  #settingsPage.mg .mg-area-head h1{font-size:30px}
  #settingsPage.mg .mg-control{grid-template-columns:1fr}#settingsPage.mg .mg-control .mg-ctl{grid-column:1;grid-row:auto;justify-content:flex-start}
  #settingsPage.mg details.mg-person>summary{grid-template-columns:44px minmax(0,1fr) auto;grid-template-areas:"av who edit" "av does does" "av facts facts"}#settingsPage.mg .mg-person .mg-facts{justify-content:flex-start}
  #settingsPage.mg .mg-timetable{display:none}
  #settingsPage.mg .mg-savebar{position:static;margin-top:16px}
  .toast-host{right:8px;left:8px;width:auto}
}
`;
