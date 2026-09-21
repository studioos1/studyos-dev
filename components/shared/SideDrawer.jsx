// ── SIDE DRAWER ──────────────────────────────────────────────────────────────
// The sliding-panel shell HelpDrawer.jsx introduced, pulled out so Account and the daily Calendar
// popup (previously both centered dim-backdrop modals, components/shared/modals.jsx's AccountModal
// and Today.jsx's "Today's Calendar") can use the exact same mechanic — deliberately NO backdrop
// and NO click-outside-to-close, unlike a normal modal: the whole point is the app stays fully
// visible and clickable behind it, so closing is always an explicit action (each consumer's own
// header supplies that — see `header` below), never an incidental outside click. Fixed-position,
// not a flex-reflow layout — App.jsx's root uses a fixed header over normal document flow, not a
// flex row, so reflowing the whole app to make room for a sidebar would mean restructuring layout
// every tab already depends on; floating on top gets the same "app stays usable" result without
// that risk, just overlapping the right edge of the screen instead of shrinking it.
//
// This is a pure shell: `header` is a full ReactNode the caller builds completely (own title, own
// close button, own extra content like Help's subtitle+tabs or nothing at all) — SideDrawer doesn't
// impose a title/icon convention, so each drawer keeps exactly the header it already had. `children`
// is the scrollable body. `width` (default 400) is capped at the viewport via CSS min(), so it
// degrades to full-width on a narrow/mobile screen without a separate breakpoint.
export function SideDrawer({open,onClose,width=400,header,children}){
  const minw=Math.min(width,352);
  return(
    <div style={{
      position:"fixed",top:0,right:0,bottom:0,zIndex:9000,
      width:open?`min(${width}px, 100vw)`:0,overflow:"hidden",
      background:"var(--card)",borderLeft:open?"1px solid var(--b1)":"none",
      boxShadow:open?"-16px 0 40px rgba(0,0,0,0.35)":"none",
      transition:"width .28s cubic-bezier(.2,.8,.3,1)",display:"flex",flexDirection:"column",
    }}>
      <div style={{padding:"22px 24px 14px",flexShrink:0,minWidth:minw}}>{header}</div>
      <div style={{flex:1,overflowY:"auto",padding:"0 24px 24px",minWidth:minw}}>{children}</div>
    </div>
  );
}

// Shared header row (icon + title + × close) for drawers that just want the plain convention the
// old centered modals already used — Account and the Calendar popup both do; HelpDrawer keeps its
// own custom header (greeting + subtitle + tabs) instead of this, passed to SideDrawer directly.
export function DrawerHeader({icon,title,onClose}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:16,fontWeight:600,color:"var(--t1)",display:"flex",alignItems:"center",gap:8}}>
        {icon&&<i className={`ti ${icon}`} style={{color:"var(--blue)"}}/>}
        {title}
      </div>
      <button onClick={onClose} style={{background:"none",border:"none",color:"var(--t3)",fontSize:18,cursor:"pointer",padding:4,lineHeight:1}}>✕</button>
    </div>
  );
}
