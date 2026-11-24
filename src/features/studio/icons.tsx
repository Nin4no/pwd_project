/** Studio 전용 단색 아이콘 (currentColor). 장식용 — 이름은 버튼의 aria-label이 담당 */
const P = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const BackIcon = () => <svg {...P}><path d="M12 4l-6 6 6 6" /></svg>;
export const UndoIcon = () => <svg {...P}><path d="M7 5L3 9l4 4" /><path d="M3 9h9a5 5 0 010 10h-2" /></svg>;
export const RedoIcon = () => <svg {...P}><path d="M13 5l4 4-4 4" /><path d="M17 9H8a5 5 0 000 10h2" /></svg>;
export const SparkIcon = () => <svg {...P}><path d="M10 2v4M10 14v4M2 10h4M14 10h4M5 5l2 2M13 13l2 2M15 5l-2 2M7 13l-2 2" /></svg>;
export const ShareIcon = () => <svg {...P}><circle cx="5" cy="10" r="2" /><circle cx="15" cy="5" r="2" /><circle cx="15" cy="15" r="2" /><path d="M7 9l6-3M7 11l6 3" /></svg>;
export const RotateIcon = () => <svg {...P}><path d="M16 10a6 6 0 11-2-4.5" /><path d="M16 3v4h-4" /></svg>;
export const CopyIcon = () => <svg {...P}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M13 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2" /></svg>;
export const TrashIcon = () => <svg {...P}><path d="M3 5h14M8 5V3h4v2M5 5l1 12h8l1-12" /></svg>;
export const FocusIcon = () => <svg {...P}><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /><circle cx="10" cy="10" r="2" /></svg>;
export const SelectIcon = () => <svg {...P}><path d="M4 3l11 6-5 1.5L8 16z" /></svg>;
export const WallIcon = () => <svg {...P}><path d="M3 16L9 4l8 9" /><circle cx="3" cy="16" r="1" /><circle cx="9" cy="4" r="1" /><circle cx="17" cy="13" r="1" /></svg>;
export const RectIcon = () => <svg {...P}><rect x="3" y="4" width="14" height="12" rx="1" /></svg>;
export const DoorIcon = () => <svg {...P}><path d="M3 17h14M5 17V4h7v13" /><path d="M12 4a10 10 0 015 9" strokeDasharray="2 2" /></svg>;
export const EraseIcon = () => <svg {...P}><path d="M8 16l-4-4 8-8 6 6-6 6H8zM10 16h7" /></svg>;
export const FitIcon = () => <svg {...P}><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg>;
export const PhotoIcon = () => <svg {...P}><rect x="2" y="4" width="16" height="12" rx="2" /><circle cx="7" cy="9" r="1.5" /><path d="M18 14l-5-5-7 7" /></svg>;
export const PanelIcon = () => <svg {...P}><rect x="3" y="3" width="14" height="14" rx="2" /><path d="M8 3v14" /></svg>;
export const HelpIcon = () => (
  <svg {...P}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M8.1 7.9a2.1 2.1 0 013.9 1c0 1.4-2 1.8-2 3" />
    <circle cx="10" cy="14.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);
