export default function Clouds({ soft = false }) {
  return (
    <div className={"clouds" + (soft ? " soft" : "")} aria-hidden="true">
      <i /><i /><i /><i />
    </div>
  );
}
