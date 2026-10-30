import { Card, Screen } from '../../components/Screen';
import { useTranslations } from '../../i18n';

export default function ProgressScreen() {
  const t = useTranslations();
  return (
    <Screen title={t('nav.progress')}>
      <Card title={t('common.comingSoon')} body={t('progress.placeholder')} />
    </Screen>
  );
}
