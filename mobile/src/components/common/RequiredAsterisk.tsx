import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { THEME } from '../../constants/theme';

export const RequiredAsterisk: React.FC = () => <Text style={styles.mark}>*</Text>;

const styles = StyleSheet.create({
  mark: {
    color: THEME.colors.emergency.main,
    fontWeight: '700',
  },
});
