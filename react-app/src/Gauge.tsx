import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

type GaugeProps = {
  /** Value 0-100. */
  value: number;
  /** Unit label shown under the value. */
  units?: string;
  /** Overall size (width and height) in points. */
  size?: number;
};

// The gauge sweeps from 135deg to 405deg (a 270deg arc), leaving a gap at the
// bottom, similar to the web UI's gauge.
const START_ANGLE = 135;
const SWEEP = 270;
const MIN_VALUE = 0;
const MAX_VALUE = 100;

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/** Build an SVG arc path from a start angle spanning `sweep` degrees. */
function arcPath(cx: number, cy: number, r: number, startAngle: number, sweep: number) {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, startAngle + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

function valueToAngle(value: number) {
  const clamped = Math.max(MIN_VALUE, Math.min(MAX_VALUE, value));
  const fraction = (clamped - MIN_VALUE) / (MAX_VALUE - MIN_VALUE);
  return START_ANGLE + fraction * SWEEP;
}

export default function Gauge({ value, units = '%', size = 260 }: GaugeProps) {
  const clamped = Math.max(MIN_VALUE, Math.min(MAX_VALUE, Math.round(value)));
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = size * 0.09;
  const r = size / 2 - strokeWidth;

  const progressSweep = (SWEEP * (clamped - MIN_VALUE)) / (MAX_VALUE - MIN_VALUE);
  const needleAngle = valueToAngle(clamped);
  const needle = polar(cx, cy, r - strokeWidth * 0.4, needleAngle);

  // Tick marks (0, 25, 50, 75, 100).
  const ticks = [0, 25, 50, 75, 100].map((t) => {
    const angle = valueToAngle(t);
    const outer = polar(cx, cy, r + strokeWidth * 0.5, angle);
    const inner = polar(cx, cy, r - strokeWidth * 0.5, angle);
    return { key: t, outer, inner };
  });

  const low = clamped < 10;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Defs>
          <LinearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={low ? '#e07a7a' : '#6FADC0'} />
            <Stop offset="1" stopColor={low ? '#f3b0b0' : '#a2ede3'} />
          </LinearGradient>
        </Defs>

        {/* Track */}
        <Path
          d={arcPath(cx, cy, r, START_ANGLE, SWEEP)}
          stroke="#E0E0E0"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />

        {/* Progress */}
        {clamped > 0 && (
          <Path
            d={arcPath(cx, cy, r, START_ANGLE, progressSweep)}
            stroke="url(#gaugeGradient)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
          />
        )}

        {/* Ticks */}
        <G>
          {ticks.map((tick) => (
            <Line
              key={tick.key}
              x1={tick.inner.x}
              y1={tick.inner.y}
              x2={tick.outer.x}
              y2={tick.outer.y}
              stroke="#333333"
              strokeWidth={1.5}
            />
          ))}
        </G>

        {/* Needle */}
        <Line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke="#000000" strokeWidth={size * 0.02} strokeLinecap="round" />
        <Circle cx={cx} cy={cy} r={size * 0.04} fill="#000000" />

        {/* Value text */}
        <SvgText x={cx} y={cy + size * 0.28} fontSize={size * 0.18} fontWeight="bold" fill="#222" textAnchor="middle">
          {`${clamped}${units}`}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
