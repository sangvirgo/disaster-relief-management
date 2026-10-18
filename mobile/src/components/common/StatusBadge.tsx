import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { RequestStatus, MissionStatus, PriorityLevel } from '../../types/api';
import { REQUEST_STATUS_LABELS, MISSION_STATUS_LABELS, PRIORITY_LABELS } from '../../constants/labels';
import { THEME } from '../../constants/theme';

interface StatusBadgeProps {
  status?: RequestStatus;
  missionStatus?: MissionStatus;
  priority?: PriorityLevel;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, missionStatus, priority }) => {
  let label = '';
  let color = THEME.colors.text.secondary;
  let bg = THEME.colors.surface.border;

  if (priority && PRIORITY_LABELS[priority]) {
    label = PRIORITY_LABELS[priority].badge;
    color = PRIORITY_LABELS[priority].color;
    bg = PRIORITY_LABELS[priority].bg;
  } else if (status && REQUEST_STATUS_LABELS[status]) {
    label = REQUEST_STATUS_LABELS[status].label;
    color = REQUEST_STATUS_LABELS[status].color;
    bg = REQUEST_STATUS_LABELS[status].bg;
  } else if (missionStatus && MISSION_STATUS_LABELS[missionStatus]) {
    label = MISSION_STATUS_LABELS[missionStatus].label;
    color = MISSION_STATUS_LABELS[missionStatus].color;
    bg = MISSION_STATUS_LABELS[missionStatus].bg;
  }

  if (!label) return null;

  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  text: {
    fontSize: THEME.typography.fontSizes.xs,
    fontWeight: '700',
  },
});
