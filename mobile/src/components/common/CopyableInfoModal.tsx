import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowRight, Check, CheckCircle2, Copy, ShieldCheck } from 'lucide-react-native';
import { THEME } from '../../constants/theme';

export interface CopyableInfoValue {
  key: string;
  label: string;
  value: string;
  sensitive?: boolean;
}

interface CopyableInfoModalProps {
  visible: boolean;
  title: string;
  description: string;
  helperText: string;
  credentials: CopyableInfoValue[];
  onClose: () => void;
  primaryAction?: {
    label: string;
    onPress: () => void;
  };
}

export const CopyableInfoModal: React.FC<CopyableInfoModalProps> = ({
  visible,
  title,
  description,
  helperText,
  credentials,
  onClose,
  primaryAction,
}) => {
  const [copiedCredential, setCopiedCredential] = useState<string | null>(null);
  const [copyErrorCredential, setCopyErrorCredential] = useState<string | null>(null);

  const handleCopy = async (credential: CopyableInfoValue) => {
    try {
      if (credential.sensitive) {
        await Clipboard.setStringAsync(credential.value, { android: { isSensitive: true } });
      } else {
        await Clipboard.setStringAsync(credential.value);
      }
      setCopiedCredential(credential.key);
      setCopyErrorCredential(null);
    } catch {
      setCopiedCredential(null);
      setCopyErrorCredential(credential.key);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={() => {
        setCopiedCredential(null);
        setCopyErrorCredential(null);
      }}
    >
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <View style={styles.successIconWrap}>
            <CheckCircle2 size={34} color={THEME.colors.success.main} strokeWidth={2.4} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.description}>{description}</Text>

          <View style={styles.saveReminder}>
            <ShieldCheck size={17} color={THEME.colors.primary.main} />
            <Text style={styles.saveReminderText}>{helperText}</Text>
          </View>

          <ScrollView
            style={styles.credentialsList}
            contentContainerStyle={styles.credentialsContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {credentials.map((credential) => {
              const copied = copiedCredential === credential.key;
              const copyFailed = copyErrorCredential === credential.key;

              return (
                <View key={credential.key} style={styles.credentialCard}>
                  <View style={styles.credentialHeader}>
                    <Text style={styles.credentialLabel}>{credential.label}</Text>
                    <TouchableOpacity
                      style={[styles.copyButton, copied && styles.copyButtonDone]}
                      onPress={() => handleCopy(credential)}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`Sao chép ${credential.label}`}
                    >
                      {copied ? (
                        <Check size={15} color={THEME.colors.success.dark} />
                      ) : (
                        <Copy size={15} color={THEME.colors.primary.main} />
                      )}
                      <Text style={[styles.copyButtonText, copied && styles.copyButtonTextDone]}>
                        {copied ? 'Đã sao chép' : 'Sao chép'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.credentialValue} selectable>
                    {credential.value}
                  </Text>
                  {copyFailed ? (
                    <Text style={styles.copyError}>Không sao chép được. Vui lòng thử lại.</Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {primaryAction ? (
            <TouchableOpacity
              style={styles.trackButton}
              onPress={primaryAction.onPress}
              activeOpacity={0.82}
              accessibilityRole="button"
            >
              <Text style={styles.trackButtonText}>{primaryAction.label}</Text>
              <ArrowRight size={18} color="#FFFFFF" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            activeOpacity={0.75}
            accessibilityRole="button"
          >
            <Text style={styles.closeButtonText}>Đóng</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
  },
  dialog: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: THEME.colors.surface.card,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    ...THEME.shadows.md,
  },
  successIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: THEME.colors.success.bg,
    borderWidth: 1,
    borderColor: THEME.colors.success.border,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  description: {
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.sm,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 8,
  },
  saveReminder: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderColor: THEME.colors.primary.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  saveReminderText: {
    flex: 1,
    color: THEME.colors.primary.dark,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    marginLeft: 8,
  },
  credentialsList: {
    flexGrow: 0,
    maxHeight: 250,
    marginTop: 12,
  },
  credentialsContent: {
    gap: 10,
  },
  credentialCard: {
    backgroundColor: THEME.colors.surface.background,
    borderColor: THEME.colors.surface.border,
    borderWidth: 1,
    borderRadius: 13,
    padding: 12,
  },
  credentialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  credentialLabel: {
    flex: 1,
    color: THEME.colors.text.secondary,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.bg,
    borderColor: THEME.colors.primary.border,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 7,
    marginLeft: 8,
  },
  copyButtonDone: {
    backgroundColor: THEME.colors.success.bg,
    borderColor: THEME.colors.success.border,
  },
  copyButtonText: {
    color: THEME.colors.primary.dark,
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 5,
  },
  copyButtonTextDone: {
    color: THEME.colors.success.dark,
  },
  credentialValue: {
    color: THEME.colors.text.primary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  copyError: {
    color: THEME.colors.emergency.main,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 5,
  },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.primary.main,
    borderRadius: 13,
    minHeight: 48,
    marginTop: 16,
  },
  trackButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginRight: 8,
  },
  closeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    marginTop: 4,
  },
  closeButtonText: {
    color: THEME.colors.text.secondary,
    fontSize: 13,
    fontWeight: '700',
  },
});
