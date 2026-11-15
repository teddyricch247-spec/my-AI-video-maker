const PATHS = {
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4',
  plus: 'M12 5v14M5 12h14',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  check: 'M5 12l5 5 9-10',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
};

export default function Icon({ name }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
