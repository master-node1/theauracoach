import { Card, Screen } from '../../components/Screen';
import { useTranslations } from '../../i18n';

export default function CoachScreen() {
  const t = useTranslations();
  return (
    <Screen title={t('nav.coach')}>
      <Card title={t('common.comingSoon')} body={t('coach.placeholder')} />
    </Screen>
  );
}
