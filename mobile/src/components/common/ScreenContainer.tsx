import React from 'react';
import { View, StyleSheet, ScrollView, Text, TouchableOpacity, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { THEME } from '../../constants/theme';

interface ScreenContainerProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  showLogo?: boolean;
}

export const ScreenContainer: React.FC<ScreenContainerProps> = ({
  children,
  title,
  subtitle,
  scrollable = true,
  onBack,
  headerRight,
  showLogo,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />

      {(title || onBack || headerRight || showLogo) && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {onBack && (
              <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <ChevronLeft size={26} color={THEME.colors.text.primary} />
              </TouchableOpacity>
            )}
            {showLogo && (
              <Image
                source={require('../../../assets/reliva-logo.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
            )}
            <View>
              {title && <Text style={styles.title}>{title}</Text>}
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
          </View>
          {headerRight && <View style={styles.headerRight}>{headerRight}</View>}
        </View>
      )}

      {scrollable ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.content}>{children}</View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: THEME.colors.surface.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surface.border,
    backgroundColor: THEME.colors.surface.card,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    marginRight: 8,
    padding: 4,
  },
  headerLogo: {
    width: 28,
    height: 28,
    borderRadius: 7,
    marginRight: 10,
  },
  title: {
    fontSize: THEME.typography.fontSizes.lg,
    fontWeight: '700',
    color: THEME.colors.text.primary,
  },
  subtitle: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
});
