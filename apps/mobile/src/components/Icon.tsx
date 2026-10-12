import type { ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

export function Icon({
  path,
  color,
  size = 24,
}: {
  path: string;
  color: ColorValue;
  size?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={path} />
    </Svg>
  );
}

export function Logo({
  primary,
  accent,
  size = 56,
}: {
  primary: string;
  accent: string;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={12} fill="none" stroke={primary} strokeWidth={4} />
      <Circle cx={16} cy={16} r={4} fill={accent} />
    </Svg>
  );
}
