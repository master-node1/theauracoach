import { Card, Screen } from '../../components/Screen';
import { useTranslations } from '../../i18n';

export default function TrainScreen() {
  const t = useTranslations();
  return (
    <Screen title={t('nav.train')}>
      <Card title={t('common.comingSoon')} body={t('train.placeholder')} />
    </Screen>
  );
}
