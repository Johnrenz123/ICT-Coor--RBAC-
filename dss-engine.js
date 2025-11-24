/**
 * DSS ENGINE - Decision Support System
 * 100% FREE - Rule-Based + Keyword Pattern Matching
 * No external APIs, no costs ever
 * 
 * Analyzes teacher behavior reports and generates actionable recommendations
 */

// ==========================================
// KEYWORD DATABASE
// ==========================================
const KEYWORDS = {
  // ACADEMIC ISSUES
  academic: {
    comprehension: ['understand', 'comprehend', 'struggle', 'difficult', 'hard time', 'confused'],
    writing: ['writing', 'composition', 'essay', 'paragraph', 'grammar', 'spelling'],
    math: ['math', 'arithmetic', 'calculation', 'number', 'algebra', 'geometry'],
    reading: ['reading', 'read', 'literacy', 'decode', 'fluency', 'phonics'],
    science: ['science', 'experiment', 'lab', 'hypothesis', 'observation'],
    performance: ['low grade', 'failing', 'score', 'grade', 'performance', 'achievement'],
  },
  
  // BEHAVIORAL ISSUES
  behavioral: {
    disruptive: ['disrupt', 'interrupt', 'talk', 'noise', 'loud', 'chaos', 'attention seeking'],
    aggressive: ['hit', 'push', 'fight', 'aggressive', 'violent', 'assault', 'threat'],
    defiant: ['refuse', 'defiant', 'won\'t', 'stubborn', 'argumentative', 'talk back'],
    dishonest: ['lie', 'cheat', 'copy', 'dishonest', 'plagiarism', 'fake'],
    bullying: ['bully', 'tease', 'mock', 'exclude', 'laugh at', 'mean', 'harassment'],
  },
  
  // ATTENDANCE/PUNCTUALITY
  attendance: {
    absent: ['absent', 'missing', 'cut class', 'skip', 'truant', 'no-show'],
    late: ['late', 'tardy', 'arrive late', 'delayed', 'not on time'],
  },
  
  // SOCIAL/EMOTIONAL
  social: {
    shy: ['shy', 'quiet', 'withdrawn', 'isolated', 'social', 'interaction', 'participate'],
    sad: ['sad', 'cry', 'upset', 'emotional', 'depressed', 'down'],
    anxious: ['anxiety', 'anxious', 'worry', 'stress', 'nervous', 'panic'],
    conflict: ['conflict', 'argue', 'disagree', 'dispute', 'peer issue', 'friend'],
  },
  
  // PHYSICAL/HEALTH
  health: {
    illness: ['sick', 'ill', 'cold', 'fever', 'unwell', 'health', 'medical'],
    fatigue: ['tired', 'fatigue', 'sleepy', 'sleep', 'exhausted', 'energy'],
    physical: ['injury', 'hurt', 'pain', 'physical', 'accident', 'hospital'],
  },
};

// ==========================================
// RULES ENGINE
// ==========================================
const RULES = {
  // Rule structure: { condition: (reports) => boolean, recommendation: {...} }
  
  multipleSameIssue: {
    name: 'Multiple Students - Same Issue',
    check: (category, severity, allReports) => {
      const sameCategory = allReports.filter(r => r.category === category);
      return sameCategory.length >= 3;
    },
    generateRecommendation: (category, severity, matchCount) => ({
      type: 'GROUP_INTERVENTION',
      title: `${category} Workshop Program`,
      description: `${matchCount} students showing ${category} issues - recommend group intervention`,
      actions: [
        'Schedule group workshop/intervention',
        'Create action plan template',
        'Track progress weekly',
      ],
      priority: 'HIGH',
      effort: 'MEDIUM',
    }),
  },

  highSeverityPattern: {
    name: 'High Severity Alert',
    check: (category, severity, allReports) => {
      return severity === 'High';
    },
    generateRecommendation: (category, severity, studentName) => ({
      type: 'URGENT_INTERVENTION',
      title: `URGENT: ${category} - High Severity`,
      description: 'High severity report requires immediate attention and parent communication',
      actions: [
        'Schedule parent meeting within 48 hours',
        'Create intervention plan',
        'Assign support staff',
        'Daily check-ins',
      ],
      priority: 'CRITICAL',
      effort: 'HIGH',
    }),
  },

  frequentReports: {
    name: 'Frequent Reporter Pattern',
    check: (studentId, allReports) => {
      const studentReports = allReports.filter(r => r.student_id === studentId);
      return studentReports.length >= 5;
    },
    generateRecommendation: (studentName, reportCount) => ({
      type: 'INDIVIDUAL_PLAN',
      title: `At-Risk Student: ${studentName}`,
      description: `${reportCount} reports indicate ongoing concerns - comprehensive support needed`,
      actions: [
        'Create Behavior Improvement Plan (BIP)',
        'Counselor referral',
        'Parent partnership meeting',
        'Daily progress monitoring',
        'Consider assessment for support services',
      ],
      priority: 'CRITICAL',
      effort: 'HIGH',
    }),
  },

  attendanceIssue: {
    name: 'Attendance Concern',
    check: (keywords) => keywords.includes('absent') || keywords.includes('late'),
    generateRecommendation: () => ({
      type: 'PARENT_COMMUNICATION',
      title: 'Attendance Issue Detected',
      description: 'Student showing attendance/punctuality concerns',
      actions: [
        'Contact parents about attendance policy',
        'Discuss barriers to attendance',
        'Create attendance contract',
        'Monitor daily attendance',
      ],
      priority: 'MEDIUM',
      effort: 'LOW',
    }),
  },

  academicAtRisk: {
    name: 'Academic Intervention',
    check: (keywords) => {
      const academicKeywords = Object.values(KEYWORDS.academic).flat();
      return keywords.some(k => academicKeywords.includes(k));
    },
    generateRecommendation: () => ({
      type: 'ACADEMIC_SUPPORT',
      title: 'Academic Support Needed',
      description: 'Student shows academic struggle - tutoring or intervention recommended',
      actions: [
        'Recommend tutoring program',
        'Assess learning needs',
        'Differentiate instruction',
        'Weekly progress checks',
      ],
      priority: 'HIGH',
      effort: 'MEDIUM',
    }),
  },

  behavioralIntervention: {
    name: 'Behavioral Support',
    check: (keywords) => {
      const behaviorKeywords = Object.values(KEYWORDS.behavioral).flat();
      return keywords.some(k => behaviorKeywords.includes(k));
    },
    generateRecommendation: () => ({
      type: 'BEHAVIORAL_SUPPORT',
      title: 'Behavioral Intervention Recommended',
      description: 'Student behavior requires structured support',
      actions: [
        'Implement positive reinforcement plan',
        'Clear behavior expectations',
        'Classroom management strategy',
        'Check-in with student daily',
      ],
      priority: 'HIGH',
      effort: 'MEDIUM',
    }),
  },

  socialEmotionalSupport: {
    name: 'Social-Emotional Support',
    check: (keywords) => {
      const socialKeywords = Object.values(KEYWORDS.social).flat();
      return keywords.some(k => socialKeywords.includes(k));
    },
    generateRecommendation: () => ({
      type: 'COUNSELING_REFERRAL',
      title: 'Social-Emotional Support Recommended',
      description: 'Student may benefit from counseling or emotional support',
      actions: [
        'Refer to school counselor',
        'Monitor emotional well-being',
        'Create safe peer group',
        'Provide coping strategies',
      ],
      priority: 'MEDIUM',
      effort: 'MEDIUM',
    }),
  },
};

// ==========================================
// DSS ENGINE FUNCTIONS
// ==========================================

/**
 * Extract keywords from text (case-insensitive, normalized)
 */
function extractKeywords(text) {
  if (!text) return [];
  
  const normalized = text.toLowerCase().trim();
  const foundKeywords = [];
  
  // Check all keyword categories
  Object.values(KEYWORDS).forEach(category => {
    Object.values(category).forEach(keywordList => {
      keywordList.forEach(keyword => {
        // Check if keyword appears in text (whole word matching)
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        if (regex.test(normalized)) {
          foundKeywords.push(keyword);
        }
      });
    });
  });
  
  return foundKeywords;
}

/**
 * Calculate confidence score based on keyword matches
 */
function calculateConfidence(keywords, keywordMatches) {
  if (!keywordMatches || keywordMatches.length === 0) return 0;
  
  const baseConfidence = Math.min(keywordMatches.length * 15, 85);
  return Math.round(baseConfidence);
}

/**
 * Generate recommendations for a single report
 */
function generateRecommendations(report, allReports = []) {
  const recommendations = [];
  const keywords = extractKeywords(report.notes);
  const confidence = calculateConfidence(report.notes, keywords);
  
  function buildPrescriptivePlan(baseRec, report, allReports) {
    // Create a structured prescriptive plan with owners, timeframe, steps, and metrics
    const common = {
      owners: [], // roles primarily responsible
      timeframe: '', // suggested duration
      expectedImpact: 'MEDIUM', // LOW | MEDIUM | HIGH
      riskIfIgnored: '',
      steps: [],
      metrics: [], // how to measure success
      reviewAfterDays: 14,
      context: {
        studentName: report.student_name || 'Student',
        category: report.category || 'General',
        severity: report.severity || 'Medium',
        reportDate: report.created_at,
        specificIssue: report.notes ? report.notes.substring(0, 100) : 'Behavior concern',
        keywords: keywords.join(', ') || 'None detected',
      },
    };

    // Get student history for context
    const studentReports = allReports.filter(r => r.student_id === report.student_id);
    const isRepeatOffender = studentReports.length >= 3;
    const hasHighSeverityHistory = studentReports.some(r => r.severity === 'High');

    switch (baseRec.type) {
      case 'URGENT_INTERVENTION':
        return {
          ...common,
          owners: ['Guidance Counselor', 'Adviser', 'Parent/Guardian', 'School Administrator'],
          timeframe: `Immediate (48 hours) + ${hasHighSeverityHistory ? '6' : '4'} weeks intensive monitoring`,
          expectedImpact: 'HIGH',
          riskIfIgnored: `Critical: Potential for ${report.category === 'Conduct' ? 'suspension or expulsion' : 'safety incident'}; ${hasHighSeverityHistory ? 'pattern escalation' : 'behavioral crisis'}`,
          steps: [
            `Immediate alert to principal about ${report.student_name}'s ${report.category.toLowerCase()} incident`,
            `Parent meeting scheduled within 24-48 hours (${hasHighSeverityHistory ? 'REQUIRED in-person' : 'phone or in-person'})`,
            `Create Crisis Response Plan addressing: "${report.notes.substring(0, 80)}..."`,
            'Assign dedicated adult mentor for daily check-ins (morning + after incident-prone periods)',
            isRepeatOffender ? 'Consider short-term behavior contract with clear consequences' : 'Establish behavior expectations and early warning signs',
            'Document all interactions and progress in student file (legal protection)',
          ],
          metrics: [
            `Zero ${report.severity} incidents of "${report.category}" within 2 weeks`,
            'Parent communication documented at least 2x per week',
            `${report.student_name} completes daily check-in log with 90%+ compliance`,
            hasHighSeverityHistory ? 'Behavioral assessment completed by week 3' : 'Trend analysis shows improvement by week 2',
          ],
          reviewAfterDays: hasHighSeverityHistory ? 5 : 7,
        };
      case 'INDIVIDUAL_PLAN':
        return {
          ...common,
          owners: ['Guidance Counselor', 'Adviser', 'Parent/Guardian'],
          timeframe: `${studentReports.length >= 5 ? '8-10' : '6-8'} weeks with reviews every ${studentReports.length >= 5 ? '2' : '3'} weeks`,
          expectedImpact: 'HIGH',
          riskIfIgnored: `Chronic pattern solidifies; ${report.category === 'Academic' ? 'grade retention risk' : 'escalation to suspension'} likely`,
          steps: [
            `Conduct root cause analysis for ${report.student_name}'s ${report.category.toLowerCase()} issues (past ${studentReports.length} reports reviewed)`,
            `Create personalized ${report.category === 'Academic' ? 'Academic Success Plan (ASP)' : 'Behavior Improvement Plan (BIP)'} targeting: "${report.notes.substring(0, 70)}..."`,
            report.category === 'Academic' 
              ? `Assign subject tutor + modified assignments for ${keywords.includes('math') ? 'math' : keywords.includes('reading') ? 'reading' : 'struggling subjects'}`
              : 'Implement token economy with daily point tracking and weekly reward',
            `Schedule ${studentReports.length >= 5 ? 'twice-weekly' : 'weekly'} check-in sessions (counselor + adviser rotation)`,
            'Parent progress reports every Friday via SMS/email with specific data',
            isRepeatOffender ? 'Develop "trigger management" plan with student input' : 'Teach replacement behaviors with role-play practice',
          ],
          metrics: [
            report.category === 'Academic' 
              ? `${report.student_name}'s grades improve by at least 1 letter grade by week 6`
              : `Incident rate drops from ${studentReports.length} reports to ≤2 by week 8`,
            '≥ 70% of daily goals met in week 3; ≥ 85% by week 6',
            `${isRepeatOffender ? 'Parent engagement in 4+ touchpoints' : 'Parent meeting attendance 100%'}`,
          ],
          reviewAfterDays: 21,
        };
      case 'GROUP_INTERVENTION':
        const affectedCount = allReports.filter(r => r.category === report.category).length;
        return {
          ...common,
          owners: ['Guidance Team', 'Grade Level Chair', 'Class Advisers'],
          timeframe: `${affectedCount >= 5 ? '6' : '4'} weeks, ${affectedCount >= 5 ? '2 sessions per week' : '1 session per week'}`,
          expectedImpact: affectedCount >= 5 ? 'HIGH' : 'MEDIUM',
          riskIfIgnored: `${affectedCount >= 5 ? 'School-wide climate issue' : 'Pattern spreads to peers'}; classroom disruption continues`,
          steps: [
            `SCOPE: ${affectedCount} students showing ${report.category.toLowerCase()} concerns - group intervention required`,
            `Design ${affectedCount >= 5 ? '6-session intensive' : '4-session'} workshop targeting "${report.category}" (e.g., ${report.category === 'Attendance' ? 'time management, morning routines' : report.category === 'Academic' ? 'study skills, test-taking' : 'self-regulation, peer conflict'})`,
            'Coordinate with teachers to reinforce skills during regular class time',
            'Provide parent info session or handouts on supporting the skill at home',
            affectedCount >= 5 ? 'Conduct classroom-wide culture check and adjust environment/systems' : 'Monitor non-participants for emerging similar issues',
          ],
          metrics: [
            `Workshop attendance: ≥${affectedCount >= 5 ? '85' : '75'}% of ${affectedCount} targeted students`,
            `${report.category} incidents reduced by ≥40% across the group by week ${affectedCount >= 5 ? '6' : '4'}`,
            `Teacher ratings: Classroom climate improves by ≥1 level on post-survey`,
          ],
          reviewAfterDays: affectedCount >= 5 ? 21 : 28,
        };
      case 'ACADEMIC_SUPPORT':
        const academicSubject = keywords.find(k => ['math', 'reading', 'writing', 'science'].includes(k)) || 'this subject';
        const severityMultiplier = report.severity === 'High' ? 1.5 : report.severity === 'Low' ? 0.7 : 1;
        return {
          ...common,
          owners: ['Subject Teacher', 'Adviser', report.severity === 'High' ? 'Academic Coordinator' : null].filter(Boolean),
          timeframe: `${Math.round(4 * severityMultiplier)}-${Math.round(6 * severityMultiplier)} weeks with ${report.severity === 'High' ? 'twice-weekly' : 'weekly'} checks`,
          expectedImpact: report.severity === 'High' ? 'HIGH' : 'MEDIUM',
          riskIfIgnored: `${report.severity === 'High' ? 'Failing grade IMMINENT; retention risk' : 'Academic gaps widen'}; confidence erosion in ${academicSubject}`,
          steps: [
            `Diagnostic assessment: Identify ${report.student_name}'s exact gaps in ${academicSubject} (issue: "${report.notes.substring(0, 50)}...")`,
            report.severity === 'High' 
              ? `URGENT: Intensive tutoring (3x/week minimum) + modified grading for catch-up period`
              : `Enroll in after-school tutoring or peer support for ${academicSubject} (2x/week)`,
            `Scaffolding: ${report.severity === 'High' ? 'Break assignments into daily mini-tasks; provide answer banks' : 'Provide study guides + extended time on assessments'}`,
            keywords.includes('homework') ? `Homework accountability: ${report.student_name} checks off completed work with teacher daily` : 'Weekly progress check-ins with subject teacher',
            `Parent communication: ${report.severity === 'High' ? 'Twice-weekly progress updates' : 'Bi-weekly summary of improvements'}`,
          ],
          metrics: [
            report.severity === 'High' 
              ? `${report.student_name} achieves passing grade (≥75%) in ${academicSubject} by week ${Math.round(6 * severityMultiplier)}`
              : `Quiz/test scores in ${academicSubject} improve by ≥15 points within 4 weeks`,
            `Homework completion rate: ≥${report.severity === 'High' ? '90' : '80'}% for ${report.student_name}`,
            `Self-report survey: ${report.student_name} rates confidence in ${academicSubject} as "improved" by end`,
          ],
          reviewAfterDays: report.severity === 'High' ? 14 : 21,
        };
      case 'BEHAVIORAL_SUPPORT':
        const behaviorType = keywords.find(k => ['disrupt', 'aggressive', 'defiant', 'bully'].includes(k)) || 'behavior';
        const isAggressiveBehavior = keywords.some(k => ['hit', 'fight', 'aggressive', 'violent'].includes(k));
        return {
          ...common,
          owners: ['Adviser', 'Subject Teachers', isAggressiveBehavior ? 'Guidance Counselor' : null].filter(Boolean),
          timeframe: `${isAggressiveBehavior ? '6-8' : '4-6'} weeks with ${isAggressiveBehavior ? 'daily' : 'twice-weekly'} monitoring`,
          expectedImpact: isAggressiveBehavior ? 'HIGH' : 'MEDIUM',
          riskIfIgnored: `${isAggressiveBehavior ? 'Safety risk; potential suspension' : 'Persistent disruption'}; loss of instructional time for all students`,
          steps: [
            `Target behavior: Address ${report.student_name}'s ${behaviorType} issue - "${report.notes.substring(0, 60)}..."`,
            `${isAggressiveBehavior ? 'Safety protocol: Establish de-escalation plan with clear adult response steps' : 'Post visual behavior expectations in classroom; review with student'}`,
            `Positive reinforcement: ${report.student_name} earns points for ${isAggressiveBehavior ? 'calm conflict resolution' : 'on-task behavior'} (exchangeable for privileges)`,
            isAggressiveBehavior 
              ? 'Mandatory cool-down space + teach alternative coping strategies (deep breathing, self-talk)'
              : 'Use low-level responses to disruption (proximity, non-verbal cues) - avoid power struggles',
            `${isAggressiveBehavior ? 'Parent contract: Immediate notification if aggressive incident occurs' : 'Weekly behavior report card sent to parents'}`,
          ],
          metrics: [
            isAggressiveBehavior
              ? `Zero aggressive incidents for ${report.student_name} within 3 weeks`
              : `${behaviorType.charAt(0).toUpperCase() + behaviorType.slice(1)} tallies reduced by ≥60% by week 4`,
            `${report.student_name} earns daily reinforcement target on ≥${isAggressiveBehavior ? '5' : '4'} days/week`,
            `Teacher satisfaction rating: "Behavior manageable without major disruption" by week ${isAggressiveBehavior ? '6' : '4'}`,
          ],
          reviewAfterDays: isAggressiveBehavior ? 14 : 21,
        };
      case 'COUNSELING_REFERRAL':
        const emotionalConcern = keywords.find(k => ['sad', 'cry', 'anxious', 'withdrawn', 'conflict'].includes(k)) || 'emotional/social concern';
        const isCrisis = keywords.some(k => ['suicide', 'self-harm', 'crisis'].includes(k)) || report.severity === 'High';
        return {
          ...common,
          owners: ['Guidance Counselor', isCrisis ? 'School Psychologist' : null, 'Adviser'].filter(Boolean),
          timeframe: `${isCrisis ? '8-10 sessions (2x/week initially)' : '6 sessions, weekly'}`,
          expectedImpact: isCrisis ? 'HIGH' : 'MEDIUM',
          riskIfIgnored: `${isCrisis ? 'Mental health crisis; safety risk' : 'Emotional distress persists'}; peer conflicts continue; academic impact`,
          steps: [
            `${isCrisis ? '🚨 CRISIS PROTOCOL: Immediate safety assessment + parent notification within 24 hours' : 'Intake session: Assess concern'} - ${report.student_name} reports "${report.notes.substring(0, 50)}..."`,
            isCrisis 
              ? 'Referral to external mental health provider + create Safety Plan with student/parent'
              : `Establish counseling goals targeting ${emotionalConcern} (student input required)`,
            `Teach coping skills: ${emotionalConcern.includes('anxious') ? 'Grounding techniques, cognitive reframing' : emotionalConcern.includes('conflict') ? 'Conflict resolution, assertiveness' : 'Emotion regulation, self-advocacy'}`,
            'Coordinate with teachers for classroom supports (breaks, check-ins, modified participation)',
            `Parent engagement: ${isCrisis ? 'Weekly progress updates + resource referrals' : 'Mid-point and end-of-counseling conferences'}`,
          ],
          metrics: [
            isCrisis 
              ? `${report.student_name} maintains safety (zero harm incidents) for 4+ consecutive weeks`
              : `Self-report: ${report.student_name} rates ${emotionalConcern} as "improved" (≥2 points on 10-point scale) by session 4`,
            isCrisis ? `External counselor/therapist engaged by week 2` : `Peer relationships: ${report.student_name} demonstrates improved social skills (teacher observation)`,
            `Academic performance: No grade decline during counseling period`,
          ],
          reviewAfterDays: isCrisis ? 7 : 21,
        };
      case 'PARENT_COMMUNICATION':
      default:
        const issueUrgency = report.severity === 'High' ? 'URGENT' : report.severity === 'Medium' ? 'Important' : 'Routine';
        return {
          ...common,
          owners: ['Adviser', report.severity === 'High' ? 'Guidance Counselor' : null].filter(Boolean),
          timeframe: `${report.severity === 'High' ? '1 week' : '2 weeks'}`,
          expectedImpact: report.severity === 'High' ? 'MEDIUM' : 'LOW',
          riskIfIgnored: `${report.severity === 'High' ? 'Issue escalates without parent support' : 'Continued misalignment'}; lack of home-school partnership`,
          steps: [
            `${issueUrgency} parent contact for ${report.student_name}: "${report.notes.substring(0, 70)}..."`,
            report.severity === 'High' 
              ? `Schedule FACE-TO-FACE meeting within 48 hours (both parents if possible) to discuss ${report.category.toLowerCase()} concern`
              : `Phone call or virtual meeting with parent/guardian within ${report.severity === 'Medium' ? '3 school days' : '1 week'}`,
            `Share specific data: ${report.category} incident on ${report.created_at ? new Date(report.created_at).toLocaleDateString() : 'recent date'} + any prior reports (${studentReports.length} total)`,
            `Partnership plan: Agree on ${report.severity === 'High' ? 'DAILY check-in method (SMS/email)' : 'weekly communication cadence'} + home consequences/supports`,
            report.severity === 'High' ? 'Document agreements in writing; both parties sign and keep copy' : 'Log all communications in student file',
          ],
          metrics: [
            `Parent contact completed and documented within ${report.severity === 'High' ? '48 hours' : '3 school days'}`,
            `Communication cadence maintained: ${report.severity === 'High' ? '5+ contacts in week 1' : 'Minimum 2 touchpoints across 2 weeks'}`,
            `${report.student_name}'s ${report.category.toLowerCase()} behavior shows improvement (verified by ${report.severity === 'High' ? 'daily logs' : 'week 2 follow-up'})`,
          ],
          reviewAfterDays: report.severity === 'High' ? 7 : 14,
        };
    }
  }
  
  // ===== RULE 1: High Severity Alert =====
  if (report.severity === 'High') {
    recommendations.push({
      ...RULES.highSeverityPattern.generateRecommendation(
        report.category,
        report.severity,
        report.student_name
      ),
      confidence: 95,
    });
  }
  
  // ===== RULE 2: Frequent Reports for Student =====
  if (allReports.length > 0) {
    const studentReports = allReports.filter(r => r.student_id === report.student_id);
    if (studentReports.length >= 5) {
      recommendations.push({
        ...RULES.frequentReports.generateRecommendation(
          report.student_name,
          studentReports.length
        ),
        confidence: 92,
      });
    }
  }
  
  // ===== RULE 3: Multiple Students - Same Category =====
  if (allReports.length > 0) {
    const sameCategory = allReports.filter(r => r.category === report.category);
    if (sameCategory.length >= 3) {
      recommendations.push({
        ...RULES.multipleSameIssue.generateRecommendation(
          report.category,
          report.severity,
          sameCategory.length
        ),
        confidence: 88,
      });
    }
  }
  
  // ===== KEYWORD-BASED RECOMMENDATIONS =====
  
  // Attendance Issue
  if (report.category === 'Attendance' || keywords.some(k => 
    KEYWORDS.attendance.absent.includes(k) || KEYWORDS.attendance.late.includes(k)
  )) {
    recommendations.push({
      ...RULES.attendanceIssue.generateRecommendation(),
      confidence: 90,
      keywords: ['absent', 'late', 'attendance'],
    });
  }
  
  // Academic Support
  if (report.category === 'Academic' || keywords.some(k =>
    Object.values(KEYWORDS.academic).flat().includes(k)
  )) {
    recommendations.push({
      ...RULES.academicAtRisk.generateRecommendation(),
      confidence: Math.max(confidence, 75),
      keywords: keywords.filter(k => Object.values(KEYWORDS.academic).flat().includes(k)),
    });
  }
  
  // Behavioral Support
  if (report.category === 'Disruption' || report.category === 'Conduct' || keywords.some(k =>
    Object.values(KEYWORDS.behavioral).flat().includes(k)
  )) {
    recommendations.push({
      ...RULES.behavioralIntervention.generateRecommendation(),
      confidence: Math.max(confidence, 80),
      keywords: keywords.filter(k => Object.values(KEYWORDS.behavioral).flat().includes(k)),
    });
  }
  
  // Social-Emotional Support
  if (keywords.some(k =>
    Object.values(KEYWORDS.social).flat().includes(k)
  )) {
    recommendations.push({
      ...RULES.socialEmotionalSupport.generateRecommendation(),
      confidence: Math.max(confidence, 78),
      keywords: keywords.filter(k => Object.values(KEYWORDS.social).flat().includes(k)),
    });
  }
  
  // Sort by confidence (highest first) and remove duplicates
  const uniqueRecs = [];
  const seen = new Set();
  
  recommendations
    .sort((a, b) => b.confidence - a.confidence)
    .forEach(rec => {
      if (!seen.has(rec.type)) {
        // Enrich with prescriptive plan details (pass report and allReports for context)
        const plan = buildPrescriptivePlan(rec, report, allReports);
        uniqueRecs.push({ ...rec, plan });
        seen.add(rec.type);
      }
    });
  
  return uniqueRecs;
}

/**
 * Analyze all reports and generate dashboard insights
 */
function analyzeAllReports(allReports) {
  const analysis = {
    totalReports: allReports.length,
    highSeverityCount: 0,
    mediumSeverityCount: 0,
    lowSeverityCount: 0,
    atRiskStudents: [],
    categoryBreakdown: {},
    severityTrends: [],
    topRecommendations: [],
    studentRiskProfile: {},
  };
  
  // Count severity levels
  allReports.forEach(report => {
    if (report.severity === 'High') analysis.highSeverityCount++;
    if (report.severity === 'Medium') analysis.mediumSeverityCount++;
    if (report.severity === 'Low') analysis.lowSeverityCount++;
    
    // Category breakdown
    analysis.categoryBreakdown[report.category] = 
      (analysis.categoryBreakdown[report.category] || 0) + 1;
  });
  
  // Identify at-risk students (5+ reports)
  const studentReportCounts = {};
  allReports.forEach(report => {
    const key = `${report.student_id}_${report.student_name}`;
    studentReportCounts[key] = (studentReportCounts[key] || 0) + 1;
  });
  
  Object.entries(studentReportCounts).forEach(([key, count]) => {
    if (count >= 5) {
      const [studentId, studentName] = key.split('_');
      analysis.atRiskStudents.push({
        studentId,
        studentName,
        reportCount: count,
        riskLevel: count >= 10 ? 'CRITICAL' : 'HIGH',
      });
    }
  });
  
  // Get top recommendations across all reports
  const allRecs = [];
  allReports.forEach(report => {
    const recs = generateRecommendations(report, allReports);
    allRecs.push(...recs.slice(0, 2)); // Top 2 per report
  });
  
  analysis.topRecommendations = allRecs
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10); // Top 10 overall
  
  return analysis;
}

// ==========================================
// EXPORTS
// ==========================================
module.exports = {
  extractKeywords,
  calculateConfidence,
  generateRecommendations,
  analyzeAllReports,
  KEYWORDS,
  RULES,
};
