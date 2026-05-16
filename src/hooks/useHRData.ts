import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';
import type { HREmployee, HRLeave } from '../types';

export function useHREmployees() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? '';
  const qc = useQueryClient();

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['hr_employees', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const ref = collection(db, 'hr_employees', brandId, 'employees');
      const snap = await getDocs(query(ref, orderBy('name')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as HREmployee));
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
  });

  const addEmployee = useMutation({
    mutationFn: async (data: Omit<HREmployee, 'id' | 'brandId' | 'createdAt' | 'updatedAt'>) => {
      const ref = collection(db, 'hr_employees', brandId, 'employees');
      await addDoc(ref, {
        ...data,
        brandId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr_employees', brandId] }),
  });

  const updateEmployee = useMutation({
    mutationFn: async ({ id, ...data }: Partial<HREmployee> & { id: string }) => {
      const ref = doc(db, 'hr_employees', brandId, 'employees', id);
      await updateDoc(ref, { ...data, updatedAt: new Date().toISOString() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr_employees', brandId] }),
  });

  const deleteEmployee = useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'hr_employees', brandId, 'employees', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr_employees', brandId] }),
  });

  const activeEmployees = employees.filter((e) => e.status === 'active');
  const totalMonthlyCost = activeEmployees.reduce((sum, e) => sum + (e.monthlyCost ?? 0), 0);

  return {
    employees,
    activeEmployees,
    totalMonthlyCost,
    isLoading,
    addEmployee,
    updateEmployee,
    deleteEmployee,
  };
}

export function useHRLeaves() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? '';
  const qc = useQueryClient();

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['hr_leaves', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const ref = collection(db, 'hr_leaves', brandId, 'leaves');
      const snap = await getDocs(query(ref, orderBy('startDate', 'desc')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as HRLeave));
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
  });

  const addLeave = useMutation({
    mutationFn: async (data: Omit<HRLeave, 'id' | 'brandId' | 'createdAt'>) => {
      const ref = collection(db, 'hr_leaves', brandId, 'leaves');
      await addDoc(ref, { ...data, brandId, createdAt: new Date().toISOString() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr_leaves', brandId] }),
  });

  const updateLeave = useMutation({
    mutationFn: async ({ id, ...data }: Partial<HRLeave> & { id: string }) => {
      await updateDoc(doc(db, 'hr_leaves', brandId, 'leaves', id), data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr_leaves', brandId] }),
  });

  const deleteLeave = useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'hr_leaves', brandId, 'leaves', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr_leaves', brandId] }),
  });

  const pendingLeaves = leaves.filter((l) => l.status === 'pending');

  return { leaves, pendingLeaves, isLoading, addLeave, updateLeave, deleteLeave };
}
