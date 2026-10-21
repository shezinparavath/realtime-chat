import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../theme';
import { Button } from './ui';

/**
 * RTC-UI-06 (spec §8): centred empty / error block. Title 16/24 600 in the text colour (not red),
 * body 14/20 muted, optional secondary action 12 px below. Errors are assertive alerts (as the old
 * ErrorBlock), empty states polite.
 */
export function StateBlock({ title, body, actionLabel, onAction, alert = false, testID, actionTestID }) {
  return (
    <View style={st.block} accessibilityLiveRegion={alert ? 'assertive' : 'polite'} testID={testID}>
      <Text style={st.title} accessibilityRole={alert ? 'alert' : undefined}>
        {title}
      </Text>
      {body ? <Text style={st.body}>{body}</Text> : null}
      {onAction ? <Button title={actionLabel} onPress={onAction} variant="secondary" style={st.action} testID={actionTestID} accessibilityLabel={actionLabel} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  block: { alignSelf: 'center', alignItems: 'center', maxWidth: 320, paddingVertical: space[8], paddingHorizontal: space[6] },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: colors.text, textAlign: 'center' },
  body: { ...type.secondary, marginTop: space[1], color: colors.textMuted, textAlign: 'center' },
  action: { marginTop: space[3] },
});
