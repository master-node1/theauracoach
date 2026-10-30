import { size, tabs } from '@aura/ui-tokens';
import { Tabs } from 'expo-router';
import { Icon } from '../../components/Icon';
import { useTranslations } from '../../i18n';
import { usePalette } from '../../theme';

/** The five tabs from the IA, in order. `today` is the index route. */
export default function TabsLayout() {
  const p = usePalette();
  const t = useTranslations('nav');
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: p.primary,
        tabBarInactiveTintColor: p['text-muted'],
        tabBarStyle: {
          backgroundColor: p.surface,
          borderTopColor: p.border,
          minHeight: size.tabBar,
        },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.id}
          name={tab.id === 'today' ? 'index' : tab.id}
          options={{
            title: t(tab.id),
            tabBarIcon: ({ color }) => <Icon path={tab.icon} color={color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
