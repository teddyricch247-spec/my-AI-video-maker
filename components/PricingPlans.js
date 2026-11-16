import Link from "next/link";

export default function PricingPlans() {
  return (
    <div className="price">
      <div className="plan">
        <h3>Single</h3>
        <div className="amt">$149</div>
        <ul>
          <li>One video up to 30 seconds</li>
          <li>Any style</li>
          <li>2 edit rounds</li>
        </ul>
        <Link className="btn dark" href="/order?plan=single">Choose Single</Link>
      </div>
      <div className="plan hot">
        <h3>Pack of 3</h3>
        <div className="amt">$399</div>
        <ul>
          <li>Three videos up to 30 seconds</li>
          <li>Mix styles freely</li>
          <li>Priority delivery</li>
          <li>2 edit rounds each</li>
        </ul>
        <Link className="btn lime" href="/order?plan=pack">Choose Pack of 3</Link>
      </div>
      <div className="plan">
        <h3>Long form</h3>
        <div className="amt">$299</div>
        <ul>
          <li>One video up to 90 seconds</li>
          <li>Any style</li>
          <li>3 edit rounds</li>
        </ul>
        <Link className="btn dark" href="/order?plan=long">Choose Long form</Link>
      </div>
    </div>
  );
}
