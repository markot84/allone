# Ανάλυση "Send for Review" Functionality

## Περιεχόμενα
1. [Τρέχουσες Περιπτώσεις Χρήσης](#1-τρέχουσες-περιπτώσεις-χρήσης)
2. [Ανάλυση ανά Περίπτωση](#2-ανάλυση-ανά-περίπτωση)
3. [Προτάσεις Υλοποίησης](#3-προτάσεις-υλοποίησης)

---

## 1. Τρέχουσες Περιπτώσεις Χρήσης

### 1.1 Strategy Weights Approval (`WeightConfigurator.tsx`)
**Τοποθεσία:** Strategy Weights page  
**Button:** "Send for Review"  
**Τρέχουσα Λειτουργία:** Αλλάζει μόνο το local state σε `pending_review`  
**Πρόβλημα:** Δεν στέλνει notification, δεν αποθηκεύει request, δεν έχει approval system

### 1.2 Content Approval Workflow (`ContentStrategy.tsx`)
**Τοποθεσία:** Content Strategy page  
**Status:** Placeholder - "Content approval workflow will be available when content items are imported"  
**Πρόβλημα:** Δεν έχει υλοποιηθεί καθόλου

### 1.3 Approval Workflow Component (`ApprovalWorkflow.tsx`)
**Τοποθεσία:** Χρησιμοποιείται στο Strategy Weights  
**Λειτουργία:** UI component που δείχνει status και επιτρέπει manual status changes  
**Πρόβλημα:** Δεν έχει integration με backend/notifications

---

## 2. Ανάλυση ανά Περίπτωση

### 2.1 Strategy Weights Approval

#### Τι Υπάρχει:
- ✅ UI component (`ApprovalWorkflow`) με status badges
- ✅ Button "Send for Review" που αλλάζει status
- ✅ Impact preview πριν το submit
- ✅ Validation (weights sum = 100%)

#### Τι Λείπει:
- ❌ Backend storage για approval requests
- ❌ Email/notification system
- ❌ Approver assignment logic
- ❌ Approval history
- ❌ Comments/notes από approver

#### Τι Πρέπει να Στείλει:
```typescript
{
  type: 'strategy_weights',
  brandId: string,
  submittedBy: {
    userId: string,
    email: string,
    name: string
  },
  strategy: {
    scenarioId: string, // 'custom' ή predefined scenario
    weights: {
      profit: number,
      stock: number,
      strategic: number,
      revenue: number,
      fit: number
    },
    totalWeight: 100
  },
  impact: {
    willPrioritize: number,
    willDeprioritize: number,
    estimatedRevenue: number,
    estimatedMargin: number
  },
  submittedAt: timestamp,
  status: 'pending_review',
  approvers: [
    {
      role: 'marketing_manager' | 'marketing_director' | 'ceo',
      userId?: string, // αν έχει assign
      email: string,
      status: 'pending' | 'approved' | 'rejected',
      reviewedAt?: timestamp,
      comments?: string
    }
  ]
}
```

#### Σε Ποιον να Στείλει:
**Προτείνεται Hierarchy:**
1. **Marketing Manager** (πρώτος approver)
   - Review για alignment με business goals
   - Verify impact assessment
   - Check weights sum = 100%
   
2. **Marketing Director** (final approver αν > threshold)
   - Αν estimated revenue impact > €50K ή
   - Αν custom scenario (όχι predefined)
   - Final sign-off

3. **CEO** (optional, για major changes)
   - Αν estimated revenue impact > €200K
   - Αν αλλάζει fundamental strategy

**Implementation:**
- User roles στο `UserProfile` (role: 'manager' | 'director' | 'ceo' | 'analyst')
- Brand-level approvers configuration
- Auto-assign based on impact thresholds

---

### 2.2 Content Approval Workflow

#### Τι Υπάρχει:
- ✅ Mock data structure (`contentApprovalFlow`)
- ✅ UI placeholder
- ❌ Δεν έχει υλοποιηθεί

#### Τι Πρέπει να Στείλει:
```typescript
{
  type: 'content_approval',
  brandId: string,
  contentItemId: string,
  stage: 'strategy_check' | 'brand_review' | 'commercial_approval',
  submittedBy: {
    userId: string,
    email: string,
    name: string
  },
  content: {
    title: string,
    type: string,
    segment: string,
    strategyMatch: string,
    isAligned: boolean
  },
  submittedAt: timestamp,
  status: 'pending_review',
  approver: {
    role: 'marketing_manager' | 'brand_manager' | 'marketing_director',
    userId?: string,
    email: string,
    status: 'pending' | 'approved' | 'rejected',
    reviewedAt?: timestamp,
    comments?: string
  }
}
```

#### Σε Ποιον να Στείλει:
**Based on `contentApprovalFlow` stages:**

1. **Strategy Alignment** (`strategy_check`)
   - **Approver:** Marketing Manager
   - **Check:** Content matches active commercial strategy
   - **Auto-flags:** Αν content δεν είναι aligned

2. **Brand Compliance** (`brand_review`)
   - **Approver:** Brand Manager
   - **Check:** Tone of voice, brand guidelines
   - **Required:** Πάντα manual review

3. **Commercial Approval** (`commercial_approval`)
   - **Approver:** Marketing Director
   - **Check:** Final sign-off before publishing
   - **Required:** Πάντα manual review

---

## 3. Προτάσεις Υλοποίησης

### 3.1 Firestore Structure

#### Collection: `approval_requests`
```typescript
{
  id: string, // auto-generated
  brandId: string,
  type: 'strategy_weights' | 'content_approval',
  status: 'pending_review' | 'approved' | 'rejected' | 'cancelled',
  submittedBy: {
    userId: string,
    email: string,
    name: string
  },
  submittedAt: timestamp,
  
  // Strategy-specific
  strategy?: {
    scenarioId: string,
    weights: Record<string, number>,
    impact: {...}
  },
  
  // Content-specific
  content?: {
    contentItemId: string,
    stage: string,
    content: {...}
  },
  
  // Approval workflow
  approvers: Array<{
    role: string,
    userId?: string,
    email: string,
    status: 'pending' | 'approved' | 'rejected',
    reviewedAt?: timestamp,
    comments?: string
  }>,
  
  // History
  history: Array<{
    action: string,
    userId: string,
    timestamp: timestamp,
    comments?: string
  }>
}
```

### 3.2 Notification System

#### Option A: Email via Firebase Cloud Functions
**Pros:**
- Reliable delivery
- Works για external users
- Professional appearance

**Cons:**
- Requires email service (SendGrid, Mailgun, etc.)
- Cost per email
- Setup complexity

**Implementation:**
```typescript
// Cloud Function: onApprovalRequestCreated
export const sendApprovalNotification = functions.firestore
  .document('approval_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const request = snap.data();
    const approvers = request.approvers.filter(a => a.status === 'pending');
    
    for (const approver of approvers) {
      await sendEmail({
        to: approver.email,
        subject: `Approval Request: ${request.type}`,
        template: 'approval-request',
        data: {
          requestId: context.params.requestId,
          submittedBy: request.submittedBy.name,
          type: request.type,
          link: `https://app.performance-plus.com/approvals/${context.params.requestId}`
        }
      });
    }
  });
```

#### Option B: In-App Notifications
**Pros:**
- No external dependencies
- Real-time updates
- Free

**Cons:**
- Users must be logged in
- No email backup

**Implementation:**
```typescript
// Collection: notifications
{
  userId: string,
  type: 'approval_request' | 'approval_approved' | 'approval_rejected',
  approvalRequestId: string,
  read: boolean,
  createdAt: timestamp
}
```

#### Option C: Hybrid (Recommended)
- In-app notifications για logged-in users
- Email fallback για critical approvals ή αν user δεν είναι online

### 3.3 Approver Assignment Logic

#### Strategy Weights:
```typescript
function assignApprovers(strategyRequest: StrategyApprovalRequest): Approver[] {
  const approvers: Approver[] = [];
  
  // Always Marketing Manager
  approvers.push({
    role: 'marketing_manager',
    email: getBrandManagerEmail(strategyRequest.brandId),
    status: 'pending'
  });
  
  // If custom scenario OR high impact → Marketing Director
  if (strategyRequest.strategy.scenarioId === 'custom' || 
      strategyRequest.impact.estimatedRevenue > 50000) {
    approvers.push({
      role: 'marketing_director',
      email: getBrandDirectorEmail(strategyRequest.brandId),
      status: 'pending'
    });
  }
  
  // If very high impact → CEO
  if (strategyRequest.impact.estimatedRevenue > 200000) {
    approvers.push({
      role: 'ceo',
      email: getBrandCEOEmail(strategyRequest.brandId),
      status: 'pending'
    });
  }
  
  return approvers;
}
```

#### Content Approval:
```typescript
function assignApprover(contentRequest: ContentApprovalRequest): Approver {
  const stageMap = {
    'strategy_check': { role: 'marketing_manager', email: getBrandManagerEmail(...) },
    'brand_review': { role: 'brand_manager', email: getBrandManagerEmail(...) },
    'commercial_approval': { role: 'marketing_director', email: getBrandDirectorEmail(...) }
  };
  
  return {
    role: stageMap[contentRequest.content.stage].role,
    email: stageMap[contentRequest.content.stage].email,
    status: 'pending'
  };
}
```

### 3.4 UI Changes Required

#### WeightConfigurator.tsx:
```typescript
const handleSendForReview = async () => {
  // 1. Validate
  if (totalWeight !== 100) return;
  
  // 2. Calculate impact
  const impact = calculateImpact(weights, products);
  
  // 3. Create approval request
  const requestId = await createApprovalRequest({
    type: 'strategy_weights',
    brandId: currentBrand.id,
    submittedBy: {
      userId: user.uid,
      email: user.email,
      name: user.displayName
    },
    strategy: {
      scenarioId: selectedScenario,
      weights,
      impact
    },
    approvers: assignApprovers({...})
  });
  
  // 4. Update local state
  setApprovalStatus('pending_review');
  
  // 5. Show success message
  toast.success('Strategy sent for review. Approvers will be notified.');
};
```

#### New Page: `/approvals`
- List pending approvals για logged-in user
- Approve/Reject actions
- Comments field
- History view

---

## 4. Implementation Priority

### Phase 1: Strategy Weights Approval (High Priority)
1. ✅ Create Firestore `approval_requests` collection
2. ✅ Create `createApprovalRequest` service function
3. ✅ Update `WeightConfigurator` to save to Firestore
4. ✅ Create approver assignment logic
5. ✅ Create in-app notifications
6. ✅ Create `/approvals` page

### Phase 2: Email Notifications (Medium Priority)
1. Setup email service (SendGrid/Mailgun)
2. Create Cloud Function for email sending
3. Create email templates
4. Add email preferences per user

### Phase 3: Content Approval (Lower Priority)
1. Implement content approval workflow
2. Create content-specific approval UI
3. Integrate με content creation flow

---

## 5. Next Steps

1. **Confirm Approver Roles:**
   - Ποιοι users έχουν role 'marketing_manager', 'marketing_director', 'ceo'?
   - Πώς αποθηκεύονται τα emails των approvers (brand settings ή user profile)?

2. **Choose Notification Method:**
   - In-app only ή hybrid με email?
   - Αν email, ποιο service (SendGrid, Mailgun, Firebase Extensions)?

3. **Define Approval Flow:**
   - Sequential (κάθε approver με τη σειρά) ή parallel (όλοι μαζί)?
   - Unanimous approval ή majority?

4. **UI/UX:**
   - Πού θα εμφανίζονται τα pending approvals?
   - Dashboard notification badge?
   - Dedicated `/approvals` page?
