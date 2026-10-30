import { Card, Screen } from '../../components/Screen';
import { useTranslations } from '../../i18n';

export default function EatScreen() {
  const t = useTranslations();
  return (
    <Screen title={t('nav.eat')}>
      <Card title={t('common.comingSoon')} body={t('eat.placeholder')} />
    </Screen>
  );
}
