import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CheckCircle2, Circle, Clock } from 'lucide-react-native';
import { THEME } from '../../constants/theme';

interface TimelineStepProps {
  title: string;
  description?: string;
  timestamp?: string;
  isCompleted: boolean;
  isCurrent: boolean;
  isLast?: boolean;
}

export const TimelineStep: React.FC<TimelineStepProps> = ({
  title,
  description,
  timestamp,
  isCompleted,
  isCurrent,
  isLast = false,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.leftColumn}>
        <View style={styles.iconContainer}>
          {isCompleted ? (
            <CheckCircle2 size={22} color={THEME.colors.success.main} />
          ) : isCurrent ? (
            <Clock size={22} color={THEME.colors.primary.main} />
          ) : (
            <Circle size={20} color={THEME.colors.text.muted} />
          )}
        </View>
        {!isLast && (
          <View
            style={[
              styles.line,
              {
                backgroundColor: isCompleted
                  ? THEME.colors.success.main
                  : THEME.colors.surface.border,
              },
            ]}
          />
        )}
      </View>

      <View style={styles.rightContent}>
        <View style={styles.headerRow}>
          <Text
            style={[
              styles.title,
              isCurrent && styles.activeTitle,
              isCompleted && styles.completedTitle,
            ]}
          >
            {title}
          </Text>
          {timestamp && <Text style={styles.timeText}>{timestamp}</Text>}
        </View>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    minHeight: 64,
  },
  leftColumn: {
    alignItems: 'center',
    width: 32,
  },
  iconContainer: {
    zIndex: 1,
    backgroundColor: THEME.colors.surface.card,
  },
  line: {
    width: 2,
    flex: 1,
    marginVertical: 4,
  },
  rightContent: {
    flex: 1,
    marginLeft: 12,
    paddingBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: THEME.typography.fontSizes.sm,
    fontWeight: '600',
    color: THEME.colors.text.secondary,
  },
  activeTitle: {
    color: THEME.colors.primary.main,
    fontWeight: '700',
    fontSize: THEME.typography.fontSizes.base,
  },
  completedTitle: {
    color: THEME.colors.text.primary,
  },
  timeText: {
    fontSize: 11,
    color: THEME.colors.text.muted,
  },
  description: {
    fontSize: THEME.typography.fontSizes.xs,
    color: THEME.colors.text.secondary,
    marginTop: 4,
    lineHeight: 18,
  },
});
