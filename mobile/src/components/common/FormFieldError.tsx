import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { THEME } from '../../constants/theme';

type FormFieldErrorProps = {
  message?: string;
};

export const FormFieldError: React.FC<FormFieldErrorProps> = ({ message }) => {
  if (!message) return null;

  return <Text style={styles.message}>{message}</Text>;
};

const styles = StyleSheet.create({
  message: {
    color: THEME.colors.emergency.main,
    fontSize: THEME.typography.fontSizes.sm,
    lineHeight: 18,
    marginTop: 5,
  },
});
