import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { THEME } from '../../constants/theme';

type CompactTextInputProps = Omit<TextInputProps, 'style'> & {
  label: string;
  required?: boolean;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  outlined?: boolean;
  dense?: boolean;
};

/** A floating label keeps the field name visible without taking a separate row. */
export const CompactTextInput: React.FC<CompactTextInputProps> = ({
  label,
  required = false,
  style,
  containerStyle,
  outlined = true,
  dense = false,
  value,
  defaultValue,
  placeholder,
  placeholderTextColor,
  accessibilityLabel,
  accessibilityHint,
  multiline = false,
  editable = true,
  onFocus,
  onBlur,
  onChangeText,
  ...inputProps
}) => {
  const [focused, setFocused] = useState(false);
  const [uncontrolledHasValue, setUncontrolledHasValue] = useState(Boolean(defaultValue));
  const hasValue = value !== undefined ? value.length > 0 : uncontrolledHasValue;
  const labelFloated = focused || hasValue;

  return (
    <View style={[styles.wrapper, containerStyle]}>
      <TextInput
        {...inputProps}
        value={value}
        defaultValue={defaultValue}
        editable={editable}
        multiline={multiline}
        style={[
          style,
          styles.inputContent,
          multiline && styles.multilineContent,
          focused && outlined && styles.focusedInput,
          !editable && styles.disabledInput,
        ]}
        placeholder={labelFloated ? placeholder : undefined}
        placeholderTextColor={placeholderTextColor ?? THEME.colors.text.muted}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint ?? (required ? 'Trường bắt buộc.' : undefined)}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        onChangeText={(nextValue) => {
          if (value === undefined) setUncontrolledHasValue(nextValue.length > 0);
          onChangeText?.(nextValue);
        }}
      />
      <Text
        accessible={false}
        pointerEvents="none"
        numberOfLines={1}
        style={[
          styles.label,
          dense && styles.denseLabel,
          labelFloated ? styles.floatedLabel : styles.restingLabel,
          dense && (labelFloated ? styles.denseFloatedLabel : styles.denseRestingLabel),
          multiline && !labelFloated && styles.restingMultilineLabel,
          focused && styles.activeLabel,
          !editable && styles.disabledLabel,
        ]}
      >
        {label}{required ? <Text style={styles.requiredMark}> *</Text> : null}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    minWidth: 0,
  },
  inputContent: {
    paddingTop: 20,
    paddingBottom: 6,
  },
  multilineContent: {
    paddingTop: 26,
    textAlignVertical: 'top',
  },
  focusedInput: {
    borderColor: THEME.colors.primary.main,
    borderWidth: 1.5,
  },
  disabledInput: {
    opacity: 0.7,
  },
  label: {
    position: 'absolute',
    left: 14,
    right: 14,
  },
  denseLabel: {
    left: 8,
    right: 8,
  },
  restingLabel: {
    top: 14,
    color: THEME.colors.text.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  restingMultilineLabel: {
    top: 13,
  },
  denseRestingLabel: {
    fontSize: 10,
  },
  floatedLabel: {
    top: 5,
    color: THEME.colors.text.secondary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  denseFloatedLabel: {
    fontSize: 9,
  },
  activeLabel: {
    color: THEME.colors.primary.main,
  },
  disabledLabel: {
    opacity: 0.8,
  },
  requiredMark: {
    color: THEME.colors.emergency.main,
    fontWeight: '800',
  },
});
