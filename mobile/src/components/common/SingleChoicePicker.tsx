import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, ChevronDown, X } from 'lucide-react-native';
import { THEME } from '../../constants/theme';

export type SingleChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

type SingleChoicePickerProps<T extends string> = {
  label: string;
  value: T;
  options: readonly SingleChoiceOption<T>[];
  onChange: (value: T) => void;
  required?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

/** Compact mobile field that opens a reachable, scrollable single-choice sheet. */
export function SingleChoicePicker<T extends string>({
  label,
  value,
  options,
  onChange,
  required = false,
  disabled = false,
  accessibilityHint = 'Mở danh sách để chọn một mục.',
}: SingleChoicePickerProps<T>) {
  const [visible, setVisible] = useState(false);
  const selectedOption = options.find((option) => option.value === value);

  const close = () => setVisible(false);
  const select = (nextValue: T) => {
    onChange(nextValue);
    close();
  };

  return (
    <>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>
          {label}{required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Text>
        <TouchableOpacity
          style={[styles.trigger, disabled && styles.disabled]}
          onPress={() => setVisible(true)}
          disabled={disabled}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`${label}${required ? ' (bắt buộc)' : ''}: ${selectedOption?.label ?? 'Chưa chọn'}`}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled }}
        >
          <Text style={styles.selectedValue} numberOfLines={1}>
            {selectedOption?.label ?? 'Chọn một mục'}
          </Text>
          <ChevronDown size={19} color={THEME.colors.text.secondary} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.overlay} accessibilityViewIsModal>
          <Pressable
            style={styles.scrim}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Đóng danh sách lựa chọn"
          />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Chọn {label.toLowerCase()}</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={close}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Đóng"
              >
                <X size={20} color={THEME.colors.text.secondary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.optionsList}
              contentContainerStyle={styles.optionsContent}
              accessibilityRole="radiogroup"
              accessibilityLabel={label}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => select(option.value)}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    accessibilityLabel={option.label}
                    accessibilityHint={option.description}
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.optionCopy}>
                      <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                        {option.label}
                      </Text>
                      {option.description ? (
                        <Text style={styles.optionDescription}>{option.description}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.radio, selected && styles.radioSelected]}>
                      {selected ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    marginTop: 4,
  },
  fieldLabel: {
    marginBottom: 7,
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
  },
  requiredMark: {
    color: THEME.colors.emergency.main,
  },
  trigger: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.surface.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedValue: {
    flex: 1,
    marginRight: 10,
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.55,
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.44)',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    maxHeight: '82%',
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: THEME.colors.surface.card,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 14,
    backgroundColor: THEME.colors.surface.divider,
  },
  sheetHeader: {
    minHeight: 42,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    flex: 1,
    marginRight: 12,
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.lg,
    fontWeight: '700',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.colors.surface.background,
  },
  optionsList: {
    flexShrink: 1,
  },
  optionsContent: {
    paddingBottom: 10,
    gap: 8,
  },
  option: {
    minHeight: 64,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.colors.surface.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: THEME.colors.surface.card,
  },
  optionSelected: {
    borderColor: THEME.colors.primary.main,
    backgroundColor: THEME.colors.primary.bg,
  },
  optionCopy: {
    flex: 1,
    marginRight: 12,
  },
  optionLabel: {
    color: THEME.colors.text.primary,
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
  },
  optionLabelSelected: {
    color: THEME.colors.primary.dark,
    fontWeight: '700',
  },
  optionDescription: {
    marginTop: 3,
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
    lineHeight: 17,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: THEME.colors.surface.divider,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: THEME.colors.primary.main,
    backgroundColor: THEME.colors.primary.main,
  },
});
